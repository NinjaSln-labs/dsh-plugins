/**
 * dsh-session-slm-router — shadow-mode SLM router for DeepSeek Harness.
 *
 * Hook: agent/inbox/inserted → extract user utterance
 *       agent/request (waterfall) → read current provider/model from LlmCallConfig
 *
 * Three-step router:
 *   1. 强弱  utterance → weak|strong via subprocess (本库 CLI)
 *   2. 换/不换 suggested_tier vs actual_tier → stay|switch_to_weak|switch_to_strong
 *   3. 健康  current model health → healthy|unhealthy|unknown
 *
 * 组合位置：host 平面（消费 agentDefaultModel / child_process.execFile（Node 内置）/ fs，不发布服务，
 * 无需 isolate realm）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { resolveConfig, type ResolvedSessionSlmRouterConfig, type SessionSlmRouterConfig } from './config.ts'

// ---------- types ----------

interface CliResult {
  tier: 'weak' | 'strong'
  confidence: number
  abstained: boolean
  model_path: string
  version: string
}

interface ShadowEvent {
  v: 1
  ts: string
  session_id: string
  turn_seq: number
  utterance_hash: string
  utterance_preview: string
  suggested_tier: 'weak' | 'strong' | null
  confidence: number | null
  abstained: boolean | null
  actual_provider: string | null
  actual_model: string | null
  actual_tier: 'weak' | 'strong' | 'unknown'
  switch: 'stay' | 'switch_to_weak' | 'switch_to_strong' | null
  target_provider: string | null
  target_model: string | null
  current_health: 'healthy' | 'unhealthy' | 'unknown'
  target_health: 'healthy' | 'unhealthy' | 'unknown' | null
  agree: boolean | null
  would_bind: boolean
  /** weak-only 实际是否换模（shadow 恒 false） */
  bound: boolean
  predict_ms: number
  predict_ok: boolean
  error: string | null
}

// ---------- tier mapping (self-contained, per spec §4) ----------

export function tierOf(
  provider: string,
  model: string,
  weakSlots: Array<{ provider: string; model: string }>,
  strongSlots: Array<{ provider: string; model: string }>,
): 'weak' | 'strong' | 'unknown' {
  const p = provider ?? ''
  const m = model ?? ''
  // Configured slots take priority over name heuristics.
  if (weakSlots.some(s => s.provider === p && s.model === m)) return 'weak'
  if (strongSlots.some(s => s.provider === p && s.model === m)) return 'strong'
  const lm = m.toLowerCase()
  // Flash / lite / mini- / haiku / weak / ox-alpha → weak
  // 注意：free 不代表弱档（deepseek-v4-pro-free 是强档），不能作为弱档依据
  // 注意：mini 用 mini[-_] 匹配，避免误命中 minimax（强档）
  if (/flash|lite|mini[-_]|\bhaiku\b|\bweak\b|ox-alpha/.test(lm)) return 'weak'
  // Pro (non-flash) / opus / sonnet / strong / gpt-4
  // + kimi (Moonshot) / qwen-coder+plus+max / glm (Zhipu) / deepseek-v3+ / deepseek-r (reasoning) / mimo (Cline) / minimax (M2.x+) → strong
  if (/pro(?!.*flash)|opus|sonnet|\bstrong\b|gpt[-–]?4|kimi|qwen.*(?:coder|plus|max)|glm|mimo|deepseek-v[3-9]|deepseek-r\d|minimax-m\d/.test(lm)) return 'strong'
  return 'unknown'
}

// ---------- utterance extraction ----------

export function extractUtterance(message: unknown): string | null {
  if (!message || typeof message !== 'object') return null
  const msg = message as Record<string, unknown>
  // Try content blocks first
  const content = msg.content as unknown[] | undefined
  if (Array.isArray(content)) {
    const text = content
      .filter((b): b is { type: 'text'; text: string } =>
        typeof b === 'object' && b !== null && (b as Record<string, unknown>).type === 'text'
      )
      .map((b) => (b as { text: string }).text)
      .join('')
      .trim()
    if (text) return text
  }
  // Fallbacks
  const text = msg.text as string | undefined
  if (text) return text.trim() || null
  const parts = msg.parts as unknown[] | undefined
  if (Array.isArray(parts)) {
    return parts
      .filter((x): x is { type: 'text'; text: string } =>
        typeof x === 'object' && x !== null && (x as Record<string, unknown>).type === 'text'
      )
      .map((x) => (x as { text: string }).text)
      .join('')
      .trim() || null
  }
  return null
}

// ---------- utterance skip filter (三层规则覆盖) ----------

/**
 * 判断 utterance 是否应跳过分类器（不送 CLI、不写影子）。
 * 三类过滤：
 *   A) DSH 内部系统消息（Background subagent / goal_round / objective 等）
 *   B) UI 表单填写任务（Tagline / Showcase Your Services / Edit your profile 等）
 *   C) 系统错误回显（400: / 本轮运行失败 / 运行失败 等）
 *
 * 大小写不敏感匹配，避免 "background subagent" 小写漏网。
 * 纯函数，便于单测。
 */
const SKIP_PATTERNS: readonly string[] = [
  // A) DSH 内部系统消息
  'background subagent',
  'subagent-id',
  '<goal_round>',
  '<goal_complete>',
  'objective:',
  '技能-触发词',
  'skill-catalog',
  // B) UI 表单填写（Upwork / Fiverr 等平台表单，非用户真实复杂任务）
  'showcase your services',
  'edit your new profile',
  'your service was created',
  'tagline can only contain',
  'add new',
  'title',
  'company name',
  'work experience',
  'please select a company',
  // C) 系统错误回显
  '400: {',
  'internalerror',
  '本轮运行失败',
  '运行失败',
  'request timed out',
]

export function shouldSkipUtterance(utterance: string): boolean {
  if (!utterance) return false
  const lower = utterance.toLowerCase()
  return SKIP_PATTERNS.some(p => lower.includes(p))
}

// ---------- shadow decision (pure, spec §4 判定表) ----------

export interface ShadowDecision {
  switch: 'stay' | 'switch_to_weak' | 'switch_to_strong' | null
  targetProvider: string | null
  targetModel: string | null
  currentHealth: 'healthy' | 'unhealthy' | 'unknown'
  targetHealth: 'healthy' | 'unhealthy' | 'unknown' | null
  agree: boolean | null
  wouldBind: boolean
}

/**
 * Spec §4 判定表：建议档 vs 实际档 → 换/不换 + 健康 + agree/would_bind。
 * 纯函数，便于单测。
 */
export function computeDecision(
  cfg: ResolvedSessionSlmRouterConfig,
  suggestedTier: 'weak' | 'strong' | null,
  actualTier: 'weak' | 'strong' | 'unknown',
  currentProvider: string,
  currentModel: string,
): ShadowDecision {
  let sw: ShadowDecision['switch'] = null
  let targetProvider: string | null = null
  let targetModel: string | null = null
  if (suggestedTier && actualTier !== 'unknown' && suggestedTier !== actualTier) {
    if (suggestedTier === 'weak' && actualTier === 'strong') {
      sw = 'switch_to_weak'
      const weakSlot = cfg.weakSlots[0]
      targetProvider = weakSlot?.provider ?? null
      targetModel = weakSlot?.model ?? null
    } else if (suggestedTier === 'strong' && actualTier === 'weak') {
      sw = 'switch_to_strong'
      const strongSlot = cfg.strongSlots[0]
      targetProvider = strongSlot?.provider ?? null
      targetModel = strongSlot?.model ?? null
    }
  } else if (suggestedTier && actualTier === suggestedTier) {
    sw = 'stay'
  }

  const knownSlots = [...cfg.weakSlots, ...cfg.strongSlots]
  const isKnownModel = knownSlots.some(s => s.provider === currentProvider && s.model === currentModel)
  const currentHealth: ShadowDecision['currentHealth'] = isKnownModel ? 'healthy' : 'unknown'
  // 无换模动作（stay/null）→ 无目标槽，target_* 保持 null（spec §8 stay 样例）
  const hasSwitchAction = sw === 'switch_to_weak' || sw === 'switch_to_strong'
  const targetHealth: ShadowDecision['targetHealth'] = hasSwitchAction ? 'healthy' : null

  const agree = suggestedTier !== null && actualTier !== 'unknown' && suggestedTier === actualTier
  // would_bind：若当时 mode=on 且目标健康是否会换模（stay 不算）
  const wouldBind = (sw === 'switch_to_weak' || sw === 'switch_to_strong') && targetHealth === 'healthy'

  return { switch: sw, targetProvider, targetModel, currentHealth, targetHealth, agree, wouldBind }
}

// ---------- weak-only 决策（S2b 裁定：只降档） ----------

export interface WeakOnlyDecision extends ShadowDecision {
  /** weak-only 是否实际换模（switch_to_weak 且目标 provider 已注册） */
  bound: boolean
}

/**
 * S3 灰度（weak-only）决策：在 computeDecision 基础上落实 S2b 三条裁定：
 *  1. abstain → stay（弃权轮保持当前档，不当 strong，C 层 8% 被证伪）
 *  2. switch_to_strong 不放行（B 层 38% 过敏）——bound=false，仅记录
 *  3. switch_to_weak 仅当目标 provider 已在 llm 注册才真正换模（bound=true），
 *     否则 target_health=unhealthy 且 bound=false（避免换到死槽破坏本轮）
 * 纯函数，便于单测。
 */
export function decideWeakOnly(
  cfg: ResolvedSessionSlmRouterConfig,
  suggestedTier: 'weak' | 'strong' | null,
  actualTier: 'weak' | 'strong' | 'unknown',
  currentProvider: string,
  currentModel: string,
  abstained: boolean,
  allowBind: boolean,
  registeredProviders: readonly string[],
): WeakOnlyDecision {
  // 弃权回退 stay（S2b：弃权轮不当 strong）
  if (abstained) {
    return {
      switch: 'stay',
      targetProvider: null,
      targetModel: null,
      currentHealth: currentHealthOf(cfg, currentProvider, currentModel),
      targetHealth: null,
      agree: false,
      wouldBind: false,
      bound: false,
    }
  }
  const d = computeDecision(cfg, suggestedTier, actualTier, currentProvider, currentModel)
  // 升强不放行（B 层过敏）：记录建议，不实际换模
  if (d.switch === 'switch_to_strong') {
    return { ...d, bound: false }
  }
  if (d.switch === 'switch_to_weak') {
    const registered = allowBind && Boolean(d.targetProvider) && registeredProviders.includes(d.targetProvider!)
    const targetHealth: WeakOnlyDecision['targetHealth'] = registered ? d.targetHealth : 'unhealthy'
    const bound = registered && d.targetHealth === 'healthy'
    return { ...d, targetHealth, bound }
  }
  return { ...d, bound: false }
}

/** 当前 provider/model 是否在已配置 slots 中（健康判定）。 */
export function currentHealthOf(
  cfg: ResolvedSessionSlmRouterConfig,
  provider: string,
  model: string,
): 'healthy' | 'unknown' {
  const knownSlots = [...cfg.weakSlots, ...cfg.strongSlots]
  return knownSlots.some(s => s.provider === provider && s.model === model) ? 'healthy' : 'unknown'
}

// ---------- CLI prediction ----------

export function predict(
  cfg: ResolvedSessionSlmRouterConfig,
  utterance: string,
): Promise<{ ok: true; result: CliResult; ms: number } | { ok: false; error: string; ms: number }> {
  const t0 = Date.now()
  const cmd = cfg.predictCmd
  const modelPath = cfg.predictModel

  if (!cmd || !modelPath) return Promise.resolve({ ok: false, error: 'missing predictCmd or predictModel', ms: 0 })
  if (!utterance || utterance.trim().length === 0) return Promise.resolve({ ok: false, error: 'empty utterance', ms: 0 })

  // predictCmd is "<interpreter> <script>" — split into executable + script arg.
  const parts = cmd.split(/\s+/)
  const file = parts[0]
  const baseArgs = [...parts.slice(1), '--model', modelPath, '--utterance', utterance]

  return new Promise((resolve) => {
    execFile(file, baseArgs, { timeout: cfg.timeoutMs, encoding: 'utf8' }, (err, stdout, stderr) => {
      const ms = Date.now() - t0
      if (!err) {
        try {
          const parsed = JSON.parse(String(stdout).trim()) as CliResult
          if (parsed.tier && parsed.model_path) {
            resolve({ ok: true, result: parsed, ms })
            return
          }
        } catch { /* fall through */ }
        resolve({ ok: false, error: 'bad CLI JSON', ms })
        return
      }
      // 隐私红线：绝不把 stderr / err.message 落盘——它们可能含完整命令行（含 --utterance 用户原话）。
      // 只返回简短原因：timeout / non-zero exit (code N) / empty utterance / other。
      const code: unknown = (err as { code?: unknown }).code
      const killed = Boolean((err as { killed?: unknown }).killed)
      const signal = (err as { signal?: unknown }).signal
      if ((code as number) === 2 || code === '2') resolve({ ok: false, error: 'empty utterance', ms })
      else if (killed || signal === 'SIGTERM') resolve({ ok: false, error: 'timeout', ms })
      else if (code !== null && code !== undefined) resolve({ ok: false, error: `non-zero exit (code ${code})`, ms })
      else resolve({ ok: false, error: 'other', ms })
    })
  })
}

// ---------- shadow writer ----------

/**
 * 构造一条影子日志事件（shadow 与 weak-only 共用）。
 * 纯函数，字段即 JSONL schema。
 */
export function buildShadowEvent(params: {
  sessionId: string
  turnSeq: number
  utterance: string
  suggestedTier: 'weak' | 'strong' | null
  confidence: number | null
  abstained: boolean | null
  actualProvider: string
  actualModel: string
  actualTier: 'weak' | 'strong' | 'unknown'
  decision: WeakOnlyDecision
  predictMs: number
  predictOk: boolean
  error: string | null
}): ShadowEvent {
  const hash = createHash('sha256').update(params.utterance).digest('hex').slice(0, 16)
  const preview = params.utterance.length > 80 ? params.utterance.slice(0, 79) + '…' : params.utterance
  const d = params.decision
  return {
    v: 1,
    ts: new Date().toISOString(),
    session_id: params.sessionId,
    turn_seq: params.turnSeq,
    utterance_hash: hash,
    utterance_preview: preview,
    suggested_tier: params.suggestedTier,
    confidence: params.confidence,
    abstained: params.abstained,
    actual_provider: params.actualProvider,
    actual_model: params.actualModel,
    actual_tier: params.actualTier,
    switch: d.switch,
    target_provider: d.targetProvider,
    target_model: d.targetModel,
    current_health: d.currentHealth,
    target_health: d.targetHealth,
    agree: d.agree,
    would_bind: d.wouldBind,
    bound: d.bound,
    predict_ms: params.predictMs,
    predict_ok: params.predictOk,
    error: params.error,
  }
}

function writeShadow(logPath: string, event: ShadowEvent): void {
  try {
    mkdirSync(join(logPath, '..'), { recursive: true })
    appendFileSync(logPath, JSON.stringify(event) + '\n')
  } catch (e) {
    console.error(`[slm-router] shadow write failed: ${String(e)}`)
  }
}

// ---------- main plugin ----------

const PLUGIN_NAME = 'dsh-session-slm-router'

export const name = PLUGIN_NAME

export default {
  name: PLUGIN_NAME,
  apply(ctx: Context, config: SessionSlmRouterConfig = {} as SessionSlmRouterConfig): void {
    const cfg = resolveConfig(config)
    if (cfg.mode !== 'shadow' && cfg.mode !== 'weak-only' && cfg.mode !== 'off') {
      console.warn(`[slm-router] mode "${cfg.mode}" not allowed; ignoring`)
      return
    }
    if (cfg.mode === 'off') return

    const logPath = join(homedir(), '.dsh', cfg.logPath ?? 'slm-shadow/session-slm-shadow.jsonl')
    let turnSeq = 0
    let currentProvider = 'unknown'
    let currentModel = 'unknown'
    // weak-only：按 agent 挂起本轮回话的预测（agent/request 消费）
    const pendingMap = new Map<string, {
      promise: ReturnType<typeof predict>
      sessionId: string
      turnSeq: number
      utterance: string
    }>()

    // Fallback current-model source: the default selection (per-call overrides
    // captured from the agent/request waterfall take precedence once seen).
    const readDefaultSelection = (): void => {
      try {
        const adm = ctx.get('agentDefaultModel') as { currentSelection?: () => { provider?: string; model?: string } } | undefined
        if (currentProvider !== 'unknown' || currentModel !== 'unknown') return // waterfall already seen a real call
        const sel = adm?.currentSelection?.()
        if (sel?.provider && sel?.model) {
          currentProvider = String(sel.provider)
          currentModel = String(sel.model)
        }
      } catch { /* optional */ }
    }
    readDefaultSelection()

    // ── hook: capture current model from agent/request waterfall ──────────
    // agent/request is a waterfall: payload = { agent, turn, step, signal }, next() returns LlmCallConfig.
    // shadow: observe (read provider/model) but do NOT modify the config.
    // weak-only: await 本轮预测 → 决策 → 若 switch_to_weak 且目标健康且目标 provider 已注册
    //            且（可选）主会话 → 返回替换后的 config（真正换模）。
    // Cordis signature is (payload, next) — NOT (agent, payload, next).
    ;(ctx.on as (event: string, fn: (...a: unknown[]) => unknown) => () => void)('agent/request', async (payload: unknown, next: () => Promise<Record<string, unknown>>) => {
      const callConfig = await next()
      if (callConfig && typeof callConfig === 'object') {
        currentProvider = String(callConfig.provider ?? 'unknown')
        currentModel = String(callConfig.model ?? 'unknown')
      }
      if (cfg.mode !== 'weak-only') return callConfig

      const p = payload as Record<string, unknown> | undefined
      const agent = p?.agent as Record<string, unknown> | undefined
      const agentId = String(agent?.id ?? 'unknown')
      const pending = pendingMap.get(agentId)
      if (!pending) return callConfig
      pendingMap.delete(agentId)

      // 换模决策依赖预测结果 → 等待本轮（最多 timeoutMs，已在 predict 内封顶）
      const predicted = await pending.promise
      readDefaultSelection()

      const actualTier = tierOf(currentProvider, currentModel, cfg.weakSlots, cfg.strongSlots)
      const suggestedTier = predicted.ok ? predicted.result.tier : null
      const confidence = predicted.ok ? predicted.result.confidence : null
      const abstained = predicted.ok ? predicted.result.abstained : false

      // 主会话判定（weakOnlyMainOnly）：仅 roots 换模，子代理只记录
      let allowBind = true
      if (cfg.weakOnlyMainOnly) {
        const agentsSvc = ctx.get('agents') as { roots?: () => Array<{ id?: unknown }> } | undefined
        const roots = agentsSvc?.roots?.() ?? []
        allowBind = roots.some(a => a && String(a.id) === agentId)
        if (!allowBind) console.info(`[slm-router] weak-only: skip bind for non-root agent ${agentId}`)
      }

      // 目标 provider 可用性：必须在 llm 注册（避免换到死槽破坏本轮）
      const llm = ctx.get('llm') as { listProviders?: () => Array<{ id?: string }> } | undefined
      const registeredProviders = llm?.listProviders?.()?.map(p => String(p.id)) ?? []

      const d = decideWeakOnly(cfg, suggestedTier, actualTier, currentProvider, currentModel, abstained, allowBind, registeredProviders)

      let nextConfig = callConfig
      if (d.bound && d.targetProvider && d.targetModel) {
        nextConfig = { ...callConfig, provider: d.targetProvider, model: d.targetModel }
        console.info(`[slm-router] weak-only bind: ${currentProvider}/${currentModel} → ${d.targetProvider}/${d.targetModel}`)
      }

      const predictOk = predicted.ok
      const predictError: string | null = predicted.ok ? null : `predict failed: ${(predicted as { ok: false; error: string; ms: number }).error}`
      const event = buildShadowEvent({
        sessionId: pending.sessionId,
        turnSeq: pending.turnSeq,
        utterance: pending.utterance,
        suggestedTier,
        confidence,
        abstained,
        actualProvider: currentProvider,
        actualModel: currentModel,
        actualTier,
        decision: d,
        predictMs: predicted.ms,
        predictOk,
        error: predictError,
      })
      writeShadow(logPath, event)
      if (!predicted.ok) {
        console.error(`[slm-router] predict failed (turn ${pending.turnSeq}): ${predictError}`)
      }

      return nextConfig
    })

    // ── hook: agent/inbox/inserted → fire shadow prediction ───────────────
    // shadow：异步预测 + 写日志（原逻辑）。
    // weak-only：只启动预测并挂起（pendingMap），由 agent/request 消费做换模决策 + 写日志。
    ;(ctx.on as (event: string, fn: (...a: unknown[]) => void) => () => void)('agent/inbox/inserted', (payload: unknown) => {
      if (cfg.mode !== 'shadow' && cfg.mode !== 'weak-only') return
      const p = payload as Record<string, unknown> | undefined
      const agent = p?.agent as Record<string, unknown> | undefined
      const msg = p?.message as Record<string, unknown> | undefined

      // Only classify user messages; skip system/agent internal messages
      // (goal_round, subagent reports, objective descriptions, etc.)
      if ((msg?.role as string) !== 'user') return

      const utterance = extractUtterance(msg ?? null)
      
      // Content layer: skip known system/form/error patterns (case-insensitive)
      if (utterance && shouldSkipUtterance(utterance)) {
        return
      }
      
      if (!utterance) return

      // sessionId from the bound agent on the payload
      const sessionId = String(agent?.id ?? 'unknown')

      turnSeq += 1

      // weak-only：挂起预测，等待 agent/request 消费
      if (cfg.mode === 'weak-only') {
        const promise = predict(cfg, utterance)
        pendingMap.set(sessionId, { promise, sessionId, turnSeq, utterance })
        return
      }

      // shadow：后台异步预测 + 写日志（原逻辑，不阻塞 agent loop）
      const ac = new AbortController()
      ctx.effect(() => () => ac.abort())

      void (async () => {
        const predicted = await predict(cfg, utterance)
        // 时序补偿：预测子进程耗时 ~200ms，期间本轮 agent/request waterfall
        // 通常已触发；若仍 unknown（如重启后首轮），再用默认选择兜底一次。
        readDefaultSelection()
        const actualTier = tierOf(currentProvider, currentModel, cfg.weakSlots, cfg.strongSlots)
        const suggestedTier = predicted.ok ? predicted.result.tier : null
        const confidence = predicted.ok ? predicted.result.confidence : null
        const abstained = predicted.ok ? predicted.result.abstained : null

        const d = computeDecision(cfg, suggestedTier, actualTier, currentProvider, currentModel)

        const predictOk = predicted.ok
        const predictError: string | null = predicted.ok ? null : `predict failed: ${(predicted as { ok: false; error: string; ms: number }).error}`

        const event = buildShadowEvent({
          sessionId,
          turnSeq,
          utterance,
          suggestedTier,
          confidence,
          abstained,
          actualProvider: currentProvider,
          actualModel: currentModel,
          actualTier,
          decision: { ...d, bound: false },
          predictMs: predicted.ms,
          predictOk,
          error: predictError,
        })

        writeShadow(logPath, event)
        if (!predicted.ok) {
          console.error(`[slm-router] predict failed (turn ${turnSeq}): ${predictError}`)
        }
      })()
    })

    console.info(`[slm-router] ${cfg.mode} mode enabled; log=${logPath}`)
  },
}
