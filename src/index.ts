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
    if (cfg.mode !== 'shadow' && cfg.mode !== 'off') {
      console.warn(`[slm-router] mode "${cfg.mode}" not allowed in S1; ignoring`)
      return
    }
    if (cfg.mode === 'off') return

    const logPath = join(homedir(), '.dsh', cfg.logPath ?? 'slm-shadow/session-slm-shadow.jsonl')
    let turnSeq = 0
    let currentProvider = 'unknown'
    let currentModel = 'unknown'

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
    // agent/request is a waterfall: payload = { turn, step, signal }, next() returns LlmCallConfig.
    // We observe (read provider/model) but do NOT modify the config — shadow only.
    // Cordis signature is (payload, next) — NOT (agent, payload, next).
    // Wrong arity made `next` undefined → catch swallowed → returned undefined →
    // agent-loop then crashed: Cannot read properties of undefined (reading 'provider').
    ;(ctx.on as (event: string, fn: (...a: unknown[]) => unknown) => () => void)('agent/request', async (_payload: unknown, next: () => Promise<Record<string, unknown>>) => {
      const callConfig = await next()
      if (callConfig && typeof callConfig === 'object') {
        currentProvider = String(callConfig.provider ?? 'unknown')
        currentModel = String(callConfig.model ?? 'unknown')
      }
      return callConfig
    })

    // ── hook: agent/inbox/inserted → fire shadow prediction ───────────────
    ;(ctx.on as (event: string, fn: (...a: unknown[]) => void) => () => void)('agent/inbox/inserted', (payload: unknown) => {
      if (cfg.mode !== 'shadow') return
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

      // Fire prediction in background; never await — must not block the agent loop.
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

        const hash = createHash('sha256').update(utterance).digest('hex').slice(0, 16)
        const preview = utterance.length > 80 ? utterance.slice(0, 79) + '…' : utterance

        const event: ShadowEvent = {
          v: 1,
          ts: new Date().toISOString(),
          session_id: sessionId,
          turn_seq: turnSeq,
          utterance_hash: hash,
          utterance_preview: preview,
          suggested_tier: suggestedTier,
          confidence,
          abstained,
          actual_provider: currentProvider,
          actual_model: currentModel,
          actual_tier: actualTier,
          switch: d.switch,
          target_provider: d.targetProvider,
          target_model: d.targetModel,
          current_health: d.currentHealth,
          target_health: d.targetHealth,
          agree: d.agree,
          would_bind: d.wouldBind,
          predict_ms: predicted.ms,
          predict_ok: predictOk,
          error: predictError,
        }

        writeShadow(logPath, event)
        if (!predicted.ok) {
          console.error(`[slm-router] predict failed (turn ${turnSeq}): ${predictError}`)
        }
      })()
    })

    console.info(`[slm-router] shadow mode enabled; log=${logPath}`)
    // DEBUG: verify hooks are registered
  },
}
