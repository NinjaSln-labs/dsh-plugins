/**
 * dsh-context-compass — shared assessment core.
 *
 * One assess() feeds the /compass command, the context_compass tool, and (in
 * light form) the Remote service: exact token-meter measurement, model
 * window, event counts (projection snapshot preferred, sessionQuery
 * fallback), and optional git / handoff / process probes. Purely read-only —
 * no session mutation, no writes, no side effects beyond the read-only
 * probes.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ResolvedConfig } from './config.ts'
import { applyHealthEvent, healthView, type SessionHealthState } from './projection.ts'
import { cacheHitRateOf, type TokenUsageLike } from './usage.ts'
import { probeCrossSession } from './knowledge.ts'
import { formatCompact, formatHitRate, formatUsd } from './util.ts'
import { PERIOD_LABEL, formatCny } from './util.ts'
import type { PriceCache, PricePeriod } from './pricing.ts'
import type { HealthRecommendation, HealthSeverity, SessionHealthProjection } from './types.ts'

export interface HealthSignals {
  total: number | null
  window: number | null
  ratio: number | null
  turns: number | null
  userMessages: number | null
  assistantMessages: number | null
  compactions: number
  /**
   * Last inferred compression ratio 1 − post/pre (0..1); null when no fold
   * was observed or the last one was inconclusive. Caliber: pressure-snapshot
   * delta estimate around a compaction, not exact compaction statistics.
   */
  compactionRatio: number | null
  /** Cache-hit ratio of the last request; null when unknown. */
  cacheHitRate: number | null
  /** Billable-equivalent per round (uncached + cacheRead × discount); null when unknown. */
  effectivePerRound: number | null
  /** effectivePerRound in USD (inputPricePerM basis); null when unknown. */
  effectivePerRoundUsd: number | null
  /** effectivePerRound in CNY when an official pricing document is active; null otherwise. */
  effectivePerRoundCny: number | null
  /** effectivePerRound × remaining rounds; null unless remainingRounds provided. */
  expectedTotalTokens: number | null
  /** expectedTotalTokens in USD; null unless remainingRounds provided. */
  expectedTotalUsd: number | null
  /** expectedTotalTokens in CNY when the official document is active; null otherwise. */
  expectedTotalCny: number | null
  /** USD-normalized input price basis per 1M tokens (miss price × usdPerCny). */
  inputPricePerM: number
  /** Official cache-miss input price per 1M in CNY; null in static mode. */
  inputMissPerMCny: number | null
  /** Official cache-hit input price per 1M in CNY; null in static mode. */
  inputHitPerMCny: number | null
  /** Official cache-miss input price per 1M in USD (static mode: the config value). */
  inputMissPerMUsd: number
  /** Official cache-hit input price per 1M in USD. */
  inputHitPerMUsd: number
  /** Current peak/off-peak period; null in static mode. */
  pricePeriod: PricePeriod
}

export interface HandoffReadiness {
  isGitRepo: boolean | null
  hasHandoff: boolean | null
  runningProcesses: string[]
  /** True when the ps probe actually ran (even with zero findings). */
  processesChecked: boolean
  /** True when git status --short is empty; null when not checked. */
  clean: boolean | null
  /** Number of uncommitted changes; null when not checked. */
  uncommittedCount: number | null
  /** HEAD line of `git log --oneline -1`; null when not checked. */
  lastCommit: string | null
  /** `## branch...origin/branch [ahead N]` first line; null when not checked. */
  branchLine: string | null
}

export interface HealthReport {
  severity: HealthSeverity
  recommendation: HealthRecommendation
  summary: string
  reason: string
  signals: HealthSignals
  probes: string[]
  handoff: HandoffReadiness
}

export interface AssessOptions {
  /** Core metrics only — skip every probe. */
  minimal?: boolean
  noGit?: boolean
  noHandoff?: boolean
  /** User-named handoff document to check (in addition to config paths). */
  docName?: string | null
  checkProcesses?: boolean
  /** Model/user estimate of remaining rounds (economy refinement). */
  remainingRounds?: number | null
  /** Work-nature self-check 1a: does the work depend on early content? */
  dependsOnEarly?: boolean
  /** Work-nature self-check 1b: are early decisions recorded (git/docs)? */
  earlyDecisionRecorded?: boolean
}

/** Exact per-round input pressure through the token meter. */
function measureTokens(ctx: Context, session: Session): number | null {
  const tokenMeter = ctx.get('tokenMeter')
  if (tokenMeter === undefined) return null
  try {
    const m = tokenMeter.measure(session)
    return typeof m === 'object' && m !== null && typeof m.totalTokens === 'number' ? m.totalTokens : null
  } catch {
    return null
  }
}

/** Read the current model's context window through the session's route. */
async function resolveWindow(ctx: Context, session: Session): Promise<number | null> {
  const agentDefaultModel = ctx.get('agentDefaultModel')
  const llm = ctx.get('llm')
  if (agentDefaultModel === undefined || llm === undefined) return null
  try {
    const sel = agentDefaultModel.currentSelection()
    const info = await llm.resolveModelInfo(sel.provider, sel.model)
    const window = info?.context?.contextWindow
    return typeof window === 'number' && window > 0 ? window : null
  } catch {
    return null
  }
}

interface Counts {
  turns: number | null
  user: number | null
  assistant: number | null
}

/** Event counts + core projection values: sessionHealth snapshot (O(1)) preferred, sessionQuery fallback. */
async function readCounts(
  ctx: Context,
  session: Session,
  agentId: string | undefined,
  signal: AbortSignal,
): Promise<{ counts: Counts; compactions: number; snapshot?: SessionHealthProjection; tokenUsage?: TokenUsageLike }> {
  const registry = ctx.get('sessionProjections')
  if (registry !== undefined) {
    try {
      const values = registry.snapshot(session).values as unknown as {
        sessionHealth?: SessionHealthProjection
        tokenUsage?: TokenUsageLike
      }
      const value = values.sessionHealth
      if (value !== undefined) {
        return {
          counts: { turns: value.turns, user: value.userMessages, assistant: value.assistantMessages },
          compactions: value.compactions,
          snapshot: value,
          // The cache-hit rate rides the CORE tokenUsage projection — the
          // same value the input-bar stats line shows (src/usage.ts formula).
          tokenUsage: values.tokenUsage as TokenUsageLike | undefined,
        }
      }
    } catch { /* fall through to sessionQuery */ }
  }
  const sessionQuery = ctx.get('sessionQuery')
  if (sessionQuery === undefined || agentId === undefined) {
    return { counts: { turns: null, user: null, assistant: null }, compactions: 0 }
  }
  try {
    const events = await sessionQuery.listEvents(agentId, { signal })
    let turns = 0
    let user = 0
    let assistant = 0
    for (const e of events) {
      const t = (e as { type?: string }).type ?? (e as { event?: { type?: string } }).event?.type ?? ''
      if (t === 'turn/start') turns++
      else if (t === 'user/message') user++
      else if (t === 'assistant/message') assistant++
    }
    return { counts: { turns, user, assistant }, compactions: 0 }
  } catch {
    return { counts: { turns: null, user: null, assistant: null }, compactions: 0 }
  }
}

/** Workspace root for probes: sandboxPolicy → session header cwd. */
function workspaceCwd(ctx: Context, session: Session): string | null {
  const sandboxPolicy = ctx.get('sandboxPolicy')
  if (sandboxPolicy !== undefined) {
    const root = (sandboxPolicy as { workspaceRoot?: string }).workspaceRoot
    if (typeof root === 'string' && root.length > 0) return root
  }
  try {
    const cwd = session.header?.cwd
    return typeof cwd === 'string' && cwd.length > 0 ? cwd : null
  } catch {
    return null
  }
}

/** Read-only `.git` existence probe through the fs service. */
async function probeGit(
  ctx: Context,
  cwd: string,
  signal: AbortSignal,
  probes: string[],
): Promise<boolean | null> {
  const fs = ctx.get('fs')
  if (fs === undefined) {
    probes.push('git 检查：不可用（未挂载 fs，已跳过）')
    return null
  }
  try {
    const t = await fs.resolve('.git', { cwd, signal })
    const stat = await fs.stat(t, signal)
    const found = stat !== undefined
    probes.push(found ? 'git 仓库：早期工作可追溯' : '非 git 工作区：恢复靠 DSH 会话记录')
    return found
  } catch {
    probes.push('git 检查：失败（已跳过）')
    return null
  }
}

/**
 * Read-only git worktree probe through ctx.subprocess (whitelisted argv only:
 * `git status --short`, `git log --oneline -1`, `git status -sb`). Feeds the
 * handoff checklist's commit/push items with real state. Returns null when
 * the subprocess seam is absent, the repo is not a git worktree, or a
 * command fails (sandbox denial included) — the checklist then reports the
 * item as unchecked with a note, never as done.
 */
async function probeGitState(
  ctx: Context,
  cwd: string,
  signal: AbortSignal,
  probes: string[],
): Promise<{ clean: boolean; uncommitted: number; lastCommit: string | null; branchLine: string | null } | null> {
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) return null
  const run = async (argv: readonly string[]): Promise<string | null> => {
    try {
      const handle = subprocess.spawn({
        argv: ['git', ...argv],
        cwd,
        stdio: { stdout: 'collect', stderr: 'collect' },
        graceMs: 5000,
        signal,
      })
      const outcome = await handle.done
      if (outcome.exitCode !== 0) return null
      return handle.collected?.stdout?.readFrom(0)?.text ?? ''
    } catch {
      return null
    }
  }
  const [status, log, branch] = await Promise.all([
    run(['status', '--short']),
    run(['log', '--oneline', '-1']),
    run(['status', '-sb']),
  ])
  if (status === null || log === null || branch === null) {
    probes.push('git 工作树：无法自动检查（subprocess 拒绝或失败）')
    return null
  }
  const uncommitted = status.trim() === '' ? 0 : status.trim().split('\n').length
  const lastCommit = log.trim() || null
  const branchLine = branch.split('\n')[0]?.trim() || null
  probes.push(
    uncommitted === 0
      ? `git 工作树：干净（最新 commit ${lastCommit ?? '未知'}）`
      : `git 工作树：${uncommitted} 个未提交变更（最新 commit ${lastCommit ?? '未知'}）`,
  )
  if (branchLine !== null && /ahead \d+/.test(branchLine)) {
    probes.push(`git 分支：${branchLine}（未 push 的提交在切换前需推送）`)
  }
  return { clean: uncommitted === 0, uncommitted, lastCommit, branchLine }
}

/** Handoff-document probe: only names the user configured or passed inline. */
async function probeHandoff(
  ctx: Context,
  cwd: string,
  signal: AbortSignal,
  config: ResolvedConfig,
  docName: string | null,
  probes: string[],
): Promise<boolean | null> {
  const fs = ctx.get('fs')
  if (fs === undefined) {
    probes.push('交接文档检查：不可用（未挂载 fs，已跳过）')
    return null
  }
  const candidates = [...(docName !== null ? [docName] : []), ...config.checks.handoff.paths]
  if (candidates.length === 0) {
    probes.push('交接文档：未配置检查路径（配置 checks.handoff.paths 或 /compass doc=文件名 指定）')
    return null
  }
  for (const name of candidates) {
    try {
      const t = await fs.resolve(name, { cwd, signal })
      const stat = await fs.stat(t, signal)
      if (stat !== undefined) {
        probes.push('交接文档：已就位')
        return true
      }
    } catch { /* keep probing */ }
  }
  probes.push(`交接文档：未找到（已检查：${candidates.join('、')}）`)
  return false
}

/** Read-only process probe: ps via ctx.subprocess, filtered to the workspace. */
async function probeProcesses(
  ctx: Context,
  cwd: string,
  signal: AbortSignal,
  probes: string[],
): Promise<string[]> {
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) {
    probes.push('进程检测：不可用（未挂载 subprocess，已跳过）')
    return []
  }
  try {
    const handle = subprocess.spawn({
      argv: ['ps', '-axo', 'pid=,command='],
      cwd,
      stdio: { stdout: 'collect', stderr: 'collect' },
      graceMs: 5000,
      signal,
    })
    const outcome = await handle.done
    if (outcome.exitCode !== 0) throw new Error(`ps exited with ${String(outcome.exitCode)}`)
    const text = handle.collected?.stdout?.readFrom(0)?.text ?? ''
    const base = cwd.split(/[\\/]/).pop() ?? ''
    const markers = ['vite', 'webpack', 'tsc --watch', 'nodemon', 'next', 'astro', 'esbuild', 'dev-server', 'dsh dev']
    const found = new Set<string>()
    for (const line of text.split('\n')) {
      const cmd = line.replace(/^\s*\d+\s+/, '').trim()
      if (cmd === '' || cmd.startsWith('ps ')) continue
      const hit = (base.length > 2 && cmd.includes(base)) || markers.some(m => cmd.includes(m))
      if (!hit) continue
      const first = cmd.split(' ')[0]?.split('/').pop()
      if (first !== undefined && first.length > 0 && !found.has(first)) found.add(first)
      if (found.size >= 5) break
    }
    const running = [...found]
    probes.push(running.length > 0
      ? `进程检测：发现 ${running.length} 个相关进程（${running.join('、')}）`
      : '进程检测：未发现工作区相关进程')
    return running
  } catch {
    probes.push('进程检测：失败（已跳过）')
    return []
  }
}

/** The full read-only assessment. */
export async function assess(
  ctx: Context,
  session: Session,
  agentId: string | undefined,
  signal: AbortSignal,
  config: ResolvedConfig,
  opts: AssessOptions = {},
): Promise<HealthReport> {
  const probes: string[] = []
  const cwd = workspaceCwd(ctx, session)

  const total = measureTokens(ctx, session)
  const window = await resolveWindow(ctx, session)
  const ratio = total !== null && window !== null && window > 0 ? total / window : null
  const { counts, compactions, snapshot, tokenUsage } = await readCounts(ctx, session, agentId, signal)

  // Live pricing (ctx-provided cache when mounted; static config otherwise) —
  // resolved before the view so the severity bills the same cache-discounted
  // figure the projection unit uses.
  const pricingCache = ctx.get('sessionHealthPricing') as PriceCache | undefined
  const model = (() => {
    try {
      const sel = (ctx.get('agentDefaultModel') as { currentSelection(): { model: string } } | undefined)?.currentSelection()
      return sel?.model ?? ''
    } catch {
      return ''
    }
  })()
  const price = pricingCache !== undefined ? pricingCache.get(model) : null

  // Severity via the exact same view the projection unit uses (config thresholds).
  // The projection's usage buckets ride its pushed value; reconstruct the fold
  // state's lastUsage so the economy dimension bills the same effectivePerRound.
  const usage = snapshot !== undefined && snapshot.uncachedInputTokens !== null && snapshot.uncachedInputTokens !== undefined
    && snapshot.cacheReadTokens !== null && snapshot.cacheReadTokens !== undefined
    ? { inputTokens: snapshot.uncachedInputTokens, cacheReadTokens: snapshot.cacheReadTokens, cacheWriteTokens: 0 }
    : null
  const state: SessionHealthState = {
    turns: counts.turns ?? 0,
    lastTurn: null,
    userMessages: counts.user ?? 0,
    assistantMessages: counts.assistant ?? 0,
    compactions,
    ...(total !== null ? { pressureTokens: total } : {}),
    ...(window !== null ? { contextWindow: window } : {}),
    ...(usage !== null ? { lastUsage: usage } : {}),
  }
  const view = healthView(state, config, price ?? undefined)

  // A3 (economyRoundFloor 接入判定)：工具/命令路径携带 remainingRounds——
  // 经济维度命中（计费当量 ≥ 窗口缩放门槛）且剩余轮数 ≥ economyRoundFloor
  // 时升一档（yellow→red）：剩得多 + 每轮都付 = 更该切。徽章无轮数信息
  // （投影不携带），维持原档；容量黄（占窗口 ≥50%）不参与（容量本身已
  // 该切，无需经济再加码）。
  //
  // healthView 的 yellow 只来自两个来源：capacityHigh 或经济命中——
  // `yellow && !capacityHigh` ⟺ 经济命中，无需在此重算 economyFloor（避免
  // 与 projection.ts 的公式分叉，单点权威）。
  const capacityHigh = ratio !== null && ratio >= config.thresholds.windowHigh
  const remainingProvided = opts.remainingRounds !== null && opts.remainingRounds !== undefined
  const economyUpgrade = view.severity === 'yellow'
    && !capacityHigh
    && remainingProvided
    && opts.remainingRounds! >= config.thresholds.economyRoundFloor
  const severity: HealthSeverity = economyUpgrade ? 'red' : view.severity
  if (economyUpgrade) {
    probes.push(`经济升级：每轮计费当量 ${formatCompact(view.effectivePerRound ?? 0)} token 且剩余 ≥${config.thresholds.economyRoundFloor} 轮，判定升一档（工具/命令路径）`)
  }

  // Work-nature (dimension B) folding into the recommendation.
  let recommendation: HealthRecommendation
  switch (severity) {
    case 'red':
    case 'yellow':
      recommendation = opts.dependsOnEarly === true && opts.earlyDecisionRecorded !== true
        ? 'danger-zone'
        : 'suggest-switch'
      break
    case 'blue':
      recommendation = 'continue-with-note'
      break
    default:
      recommendation = 'continue'
  }

  // Probes (skipped in minimal mode / by flags / by config).
  const gitEnabled = config.checks.git.enabled && !opts.noGit && !opts.minimal
  const handoffEnabled = config.checks.handoff.enabled && !opts.noHandoff && !opts.minimal
  // 进程探测（增量信号，默认关闭——DESIGN §4.6「关闭时跳过」）：
  // config 开关控制默认；checkProcesses（/compass processes 参数 / 工具路径）
  // 显式强制开启——README「/compass processes — 强制进程探测」的语义。
  const processEnabled = (config.checks.processes.enabled || opts.checkProcesses === true) && !opts.minimal

  let isGitRepo: boolean | null = null
  let hasHandoff: boolean | null = null
  let runningProcesses: string[] = []
  let processesChecked = false
  let clean: boolean | null = null
  let uncommittedCount: number | null = null
  let lastCommit: string | null = null
  let branchLine: string | null = null
  if (cwd !== null) {
    if (gitEnabled) {
      isGitRepo = await probeGit(ctx, cwd, signal, probes)
      // Automate the handoff checklist's commit/push items with real state.
      if (isGitRepo === true) {
        const gitState = await probeGitState(ctx, cwd, signal, probes)
        if (gitState !== null) {
          clean = gitState.clean
          uncommittedCount = gitState.uncommitted
          lastCommit = gitState.lastCommit
          branchLine = gitState.branchLine
        }
      }
    } else if (opts.noGit) probes.push('git 检查：已跳过')
    if (handoffEnabled) hasHandoff = await probeHandoff(ctx, cwd, signal, config, opts.docName ?? null, probes)
    else if (opts.noHandoff) probes.push('交接文档检查：已跳过')
    if (processEnabled) {
      runningProcesses = await probeProcesses(ctx, cwd, signal, probes)
      processesChecked = true
    }
  } else {
    probes.push('工作区根目录未知：git / 交接文档 / 进程检查已跳过')
  }
  if (!opts.minimal && config.checks.sessionResume.enabled) {
    probes.push('DSH 会话持久化：会话自动落盘，新会话可从会话列表恢复')
  }
  // 知识库联动（解耦版，D2）：可选探测 ctx.get('knowledge') 做只读跨会话
  // 回顾；未装则 probe 一行跳过。minimal 模式跳过（核心指标仅）。
  if (!opts.minimal && config.checks.knowledge.enabled) {
    await probeCrossSession(ctx, agentId, signal, probes)
  }

  // Cache-hit accounting + cost expectation. The cache-hit RATE rides the
  // core tokenUsage projection (single algorithm in src/usage.ts — same
  // value the input-bar stats line shows); the money buckets ride the
  // sessionHealth projection snapshot read above (the exact tokenMeter
  // measurement stays the primary pressure source).
  const cacheHitRate = cacheHitRateOf(tokenUsage)
  // Compression ratio: rides the projection unit's fold inference (1 − post/pre
  // from pressure snapshots around a compaction; snapshot-delta caliber, not
  // exact compaction statistics). Null headless (no projection registry) or
  // before the first observed fold.
  const compactionRatio = snapshot?.compressionRatio ?? null
  let effectivePerRound: number | null = null
  let effectivePerRoundUsd: number | null = null
  let effectivePerRoundCny: number | null = null
  let pricePeriodFromProjection: PricePeriod = null
  if (snapshot !== undefined) {
    // `?? null`: a snapshot missing a newer field must read as null, not
    // undefined — `!== null` checks elsewhere would then treat it as known.
    effectivePerRound = snapshot.effectivePerRound ?? null
    effectivePerRoundUsd = snapshot.effectivePerRoundUsd ?? null
    effectivePerRoundCny = snapshot.effectivePerRoundCny ?? null
    pricePeriodFromProjection = snapshot.pricePeriod ?? null
  }
  if (cacheHitRate !== null) {
    probes.push(`缓存命中率 ${formatHitRate(cacheHitRate)}（会话累计，与输入栏统计同口径；命中高说明上下文稳定）`)
  }
  if (compactionRatio !== null) {
    probes.push(`上次压缩比例 ≈ ${Math.round(compactionRatio * 100)}%（按压缩前后压力快照差值推断——快照口径，非精确统计）`)
  }
  const expectedTotalTokens = effectivePerRound !== null
    && opts.remainingRounds !== null && opts.remainingRounds !== undefined
    ? effectivePerRound * opts.remainingRounds
    : null
  const expectedTotalUsd = effectivePerRoundUsd !== null
    && opts.remainingRounds !== null && opts.remainingRounds !== undefined
    ? effectivePerRoundUsd * opts.remainingRounds
    : null
  const expectedTotalCny = effectivePerRoundCny !== null
    && opts.remainingRounds !== null && opts.remainingRounds !== undefined
    ? effectivePerRoundCny * opts.remainingRounds
    : null

  // Human-readable verdict. Yellow's reason branches on the same driver the
  // projection unit used: capacity (ratio ≥ windowHigh) or economy (billable-
  // equivalent per round, cache-discounted, against the window-scaled floor).
  const pct = ratio !== null ? Math.round(ratio * 100) : null
  const pricePeriod = price?.period ?? pricePeriodFromProjection
  const inputMissPerMCny = price !== null ? price.missPerMCny : null
  const inputHitPerMCny = price !== null ? price.hitPerMCny : null
  const inputMissPerMUsd = price !== null ? price.missPerMUsd : config.cost.inputPricePerM
  const inputHitPerMUsd = price !== null ? price.hitPerMUsd : inputMissPerMUsd * config.cost.cacheHitDiscount
  const costNote = effectivePerRoundCny !== null && effectivePerRoundUsd !== null
    ? `计费预期约 ${formatCny(effectivePerRoundCny)}/轮（≈${formatUsd(effectivePerRoundUsd)}；输入价 ¥${inputMissPerMCny ?? 0}/M / $${inputMissPerMUsd} ${pricePeriod !== null ? PERIOD_LABEL[pricePeriod] : ''}，缓存命中 ¥${inputHitPerMCny ?? 0}/M / $${inputHitPerMUsd}，不含输出）`
    : effectivePerRoundUsd !== null
      ? `计费预期约 ${formatUsd(effectivePerRoundUsd)}/轮（输入价 $${config.cost.inputPricePerM}/M，缓存命中按 ${Math.round(config.cost.cacheHitDiscount * 100)}% 计，不含输出）`
      : ''
  const remainingNote = opts.remainingRounds !== null && opts.remainingRounds !== undefined
    && opts.remainingRounds >= config.thresholds.economyRoundFloor
    ? `（剩余约 ${opts.remainingRounds} 轮：${expectedTotalCny !== null
      ? `预计输入费用 ≈ ${formatCny(expectedTotalCny)}（≈${formatUsd(expectedTotalUsd ?? 0)}）`
      : expectedTotalUsd !== null
        ? `预计输入费用 ≈ ${formatUsd(expectedTotalUsd)}`
        : `按 ${formatCompact(effectivePerRound ?? total ?? 0)} token/轮估算，费用累积明显`}）`
    : ''
  let reason: string
  switch (severity) {
    case 'red':
      reason = economyUpgrade
        ? `每轮计费约 ${formatCompact(effectivePerRound ?? 0)} token（已计缓存折扣）且剩余约 ${opts.remainingRounds} 轮——费用将显著累积，建议尽快在任务边界收尾并交接。`
        : `上下文已占窗口 ${pct}%，处于危险区；建议尽快在任务边界收尾，并先补交接（文档 + commit）。`
      break
    case 'yellow':
      reason = capacityHigh
        ? `上下文已占窗口 ${pct}%，早期内容开始被压缩；若剩余工作还多，开新会话更划算。${remainingNote}`
        : `每轮计费约 ${formatCompact(effectivePerRound ?? 0)} token（已计缓存折扣），费用可观；若剩余工作还多，开新会话更划算。${remainingNote}`
      break
    case 'blue':
      reason = `上下文占用 ${pct}%（中等）——继续没问题，留意窗口压力；如需切换，先补交接再切。`
      break
    default:
      reason = ratio !== null
        ? `上下文只用了窗口的 ${pct}%，空间充足，没有切换的必要。`
        : `每轮输入约 ${formatCompact(total ?? 0)} token，经济很轻，没有切换的必要。`
  }
  if (recommendation === 'danger-zone') {
    reason += ' 当前工作依赖早期内容且决策依据未记录——裸切会丢失隐性上下文，必须先补交接。'
  }
  if (costNote !== '' && severity !== 'green') reason += ` ${costNote}`

  const summary = ({
    'danger-zone': '危险区：依赖早期内容且无记录——先补交接（文档 + commit）再考虑切换',
    'suggest-switch': '建议在任务边界收尾；剩余工作多则开新会话更划算',
    'continue-with-note': '继续但留意窗口压力',
    continue: '放心继续',
  } satisfies Record<HealthRecommendation, string>)[recommendation]

  return {
    severity,
    recommendation,
    summary,
    reason,
    signals: {
      total,
      window,
      ratio,
      turns: counts.turns,
      userMessages: counts.user,
      assistantMessages: counts.assistant,
      compactions,
      compactionRatio,
      cacheHitRate,
      effectivePerRound,
      effectivePerRoundUsd,
      effectivePerRoundCny,
      expectedTotalTokens,
      expectedTotalUsd,
      expectedTotalCny,
      inputPricePerM: inputMissPerMUsd,
      inputMissPerMCny,
      inputHitPerMCny,
      inputMissPerMUsd,
      inputHitPerMUsd,
      pricePeriod,
    },
    probes,
    handoff: {
      isGitRepo,
      hasHandoff,
      runningProcesses,
      processesChecked,
      clean,
      uncommittedCount,
      lastCommit,
      branchLine,
    },
  }
}
