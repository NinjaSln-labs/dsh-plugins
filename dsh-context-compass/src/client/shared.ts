/** dsh-context-compass — client shared pure logic/types (extracted from the monolith entry). */
import type { SessionHealthProjection, HealthSeverity } from '../types.ts'
import { SNAPSHOT_SEPARATOR } from '../knowledge.ts'
import { formatCompact } from '../util.ts'
/** Null-safe compact token display — util.ts formatCompact with the unknown fallback. */
export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined) return '未知'
  return formatCompact(n)
}

/**
 * Visible severity label — uniformly 4 characters per column head / row
 * cell, and the wording must stay MONOTONIC (no tier may read lighter than
 * the one below it): 放心继续 → 继续留意 → 建议收尾 → 尽快收尾. The full
 * advice text (hover / /compass) carries the nuance; this is the速记.
 */
export const SEVERITY_LABEL: Record<HealthSeverity, string> = {
  green: '放心继续',
  blue: '继续留意',
  yellow: '建议收尾',
  red: '尽快收尾',
}

/** aria-label variant keeps the color word: screen readers cannot see the chip color. */
export const SEVERITY_ARIA: Record<HealthSeverity, string> = {
  green: '绿：放心继续',
  blue: '蓝：继续留意',
  yellow: '黄：建议收尾',
  red: '红：尽快收尾',
}

/** Projection face shape from the runtime client. */
export interface ProjectionFace {
  getSnapshot(): unknown
  subscribe(listener: () => void): () => void
}

/**
 * token-meter's contextPressure projection value (the harness core publishes
 * it alongside sessionHealth; compaction-aware).
 */
export interface ContextPressureLike {
  /** Provider-reported prompt size of the most recent request. */
  pressureTokens?: number
  /** What the NEXT request's prompt would cost (reacts to compaction). */
  projectedTokens?: number
  /** Newest known route capacity. */
  contextWindow?: number
}

/**
 * Merge the sessionHealth verdict with token-meter's compaction-aware
 * contextPressure numbers: the occupancy figure the badge displays should be
 * "what the next request costs", not a stale pre-compaction sample. Pure.
 */
export function mergePressure(
  proj: SessionHealthProjection | undefined,
  pressure: ContextPressureLike | undefined,
): { total: number | null; window: number | null; ratio: number | null; projected: number | null } {
  const total = proj?.total ?? pressure?.pressureTokens ?? pressure?.projectedTokens ?? null
  const window = proj?.window ?? pressure?.contextWindow ?? null
  const ratio = total !== null && window !== null && window > 0 ? total / window : null
  const projected = pressure?.projectedTokens ?? null
  return { total, window, ratio, projected }
}

/**
 * 压缩后判定滞后检测（pure）：severity 判定走 last-wins 压力（压缩前快照），
 * 占用条走 compaction-aware projectedTokens（下次请求成本）——两者分叉说明
 * 判定尚未被下一次请求刷新。差异 ≥5 个百分点且确实发生过压缩才标注
 * （roadmap「压缩后判定滞后标注」）。
 */
export function lagOf(
  proj: SessionHealthProjection | undefined,
  pressure: ContextPressureLike | undefined,
): { lag: boolean; oldPct: number | null; newPct: number | null } {
  const merged = mergePressure(proj, pressure)
  const pctOf = (t: number | null): number | null =>
    t !== null && merged.window !== null && merged.window > 0
      ? Math.min(Math.round((t / merged.window) * 100), 100)
      : null
  const oldPct = pctOf(merged.total)
  const newPct = pctOf(merged.projected)
  const lag = (proj?.compactions ?? 0) > 0
    && merged.projected !== null
    && merged.total !== null
    && merged.total > 0
    && merged.projected < merged.total
    && oldPct !== null && newPct !== null
    && oldPct - newPct >= 5
  return { lag, oldPct, newPct }
}

/** Commands Remote face (core, always mounted). */
export interface CommandsRemote {
  execute(sessionId: string, line: string): Promise<unknown>
}

/** Parsed structure of one /compass report. */
export interface CompassReport {
  /** 绿/蓝/黄/红; null when the text does not carry the mark. */
  severity: 'green' | 'blue' | 'yellow' | 'red' | null
  /** First-line conclusion without markdown bold markers. */
  summary: string
  /** Reason line(s) right below the conclusion. */
  reason: string
  /** Detail rows (会话规模 / 每轮 / 缓存命中 / 计费…). */
  metrics: string[]
  /** Handoff checklist rows verbatim ([x]/[ ]). */
  checklist: string[]
}

const SEV_MAP: Record<string, 'green' | 'blue' | 'yellow' | 'red'> = {
  绿: 'green',
  蓝: 'blue',
  黄: 'yellow',
  红: 'red',
}

/** Best-effort parser for the report text produced by buildCommandText. */
export function parseCompassReport(text: string): CompassReport {
  const lines = text.split(/\r?\n/)
  const sev = text.match(/健康度：\*\*(绿|蓝|黄|红)\*\*/)
  const summary = (lines[0] ?? '').replace(/\*\*/g, '').trim()
  const rest = lines.slice(1)
  const reason: string[] = []
  const metrics: string[] = []
  const checklist: string[] = []
  let inChecklist = false
  for (const raw of rest) {
    const line = raw.trim()
    if (line === '') continue
    // 尾部结构化交接快照段（buildCommandText 始终追加）：`---` 起头，
    // 机器摄取区，不属于人读卡片——遇到即停止解析（快照段之后无用户内容）。
    // 分隔行与 knowledge.ts 共享 SNAPSHOT_SEPARATOR（防两处漂移）。
    if (line === SNAPSHOT_SEPARATOR) break
    if (line.startsWith('- [x]') || line.startsWith('- [ ]')) {
      inChecklist = true
      checklist.push(line)
      continue
    }
    if (inChecklist) continue
    if (line.startsWith('- ')) { metrics.push(line.slice(2).trim()); continue }
    if (line === '详情：' || line === '切换前检查：') continue
    reason.push(line)
  }
  return {
    severity: sev !== null ? SEV_MAP[sev[1]] ?? null : null,
    summary: summary !== '' ? summary : '（无结论）',
    reason: reason.join(' '),
    metrics,
    checklist,
  }
}
