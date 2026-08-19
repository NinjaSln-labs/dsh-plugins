/**
 * dsh-context-compass — 知识库联动（解耦版，D2）。
 *
 * 两个互补、都零依赖的动作：
 *
 * 1. `/compass` 报告尾部附**结构化交接快照段**（固定键名、纯文本、可 grep）
 *    ——任何记忆/知识插件、甚至用户自己都能摄取，不特指 dsh-knowledge-sqlite。
 * 2. **可选探测** `ctx.get('knowledge')`：存在则用其只读 `search()` 检索历史
 *    交接快照，给当前 `/compass` 加一段「跨会话回顾」；不存在则跳过（probe
 *    一行说明），绝不报错、不依赖、不影响未装该插件的用户。
 *
 * 写回刻意不做：`knowledge` 的写入面要么是内部 `_seedWrite`（trusted writer，
 * 插件无正当身份）、要么是带 ask 门控的 `knowledge_write` 工具——留给用户/
 * 模型显式调用，插件不越权、不绕过门控。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { HealthReport } from './assess.ts'

/** 快照段的固定标识（dedupeKey / 检索词都用它）——跨会话回顾的稳定锚点。 */
export const KNOWLEDGE_SNAPSHOT_KEY = 'context-compass-handoff-snapshot'

/**
 * 快照段起始分隔行。parseCompassReport（client）在报告正文遇到它即停止
 * 解析——快照段是机器摄取区，不属于人读卡片。单一常量防两处漂移
 * （复核 P3 建议）。
 */
export const SNAPSHOT_SEPARATOR = '---'

/** 检索历史快照的查询词：FTS trigram 中文子串 ≥3 字符可命中。 */
const SNAPSHOT_QUERY = '交接快照'

/**
 * Build the structured handoff-snapshot block appended to the /compass
 * report. Fixed keys, plain text, grep-able — deliberately decoupled from
 * any specific knowledge backend.
 */
export function buildSnapshotText(report: HealthReport): string {
  const s = report.signals
  const h = report.handoff
  const lines = [
    SNAPSHOT_SEPARATOR,
    `交接快照（${KNOWLEDGE_SNAPSHOT_KEY}）`,
    `severity: ${report.severity}`,
    `recommendation: ${report.recommendation}`,
    ...(typeof s.compactions === 'number' && s.compactions > 0
      ? [`compacted: ${s.compactions}`, ...(typeof s.compactionRatio === 'number' && Number.isFinite(s.compactionRatio)
          ? [`compression_ratio: ${Math.round(s.compactionRatio * 100)}`]
          : [])]
      : []),
    ...(typeof s.turns === 'number' ? [`turns: ${s.turns}`] : []),
    ...(h.uncommittedCount !== null ? [`uncommitted: ${h.uncommittedCount}`] : []),
    ...(h.hasHandoff !== null ? [`handoff_ready: ${h.hasHandoff ? 'true' : 'false'}`] : []),
    `timestamp: ${new Date().toISOString()}`,
  ]
  return lines.join('\n')
}

/** Loose face of the optional `knowledge` service (only what we read). */
interface KnowledgeLike {
  search?(query: string, opts?: {
    scope?: string
    expand?: boolean
    signal?: AbortSignal
  }): Promise<{
    hits?: Array<{ content?: string; createdAt?: number; dedupeKey?: string | null }>
  }>
}

/**
 * Optional cross-session lookback: when a `knowledge` service is mounted,
 * search for the last handoff snapshot (read-only; workspace-scope safe) and
 * return a one-line "跨会话回顾" note. Returns null when the service is
 * absent, the search fails, or no snapshot exists — never throws.
 *
 * The knowledge service derives the caller identity (workspaceId=cwd) from
 * `agents.currentInitiator()` — which is UNDEFINED inside a /compass command
 * handler (commands run outside the agent-turn chain). So the search is
 * wrapped in `agents.withInitiator(agent, …)` to give it a real initiator
 * boundary; otherwise search returns empty hits even when snapshots exist.
 */
export async function probeCrossSession(
  ctx: Context,
  agentId: string | undefined,
  signal: AbortSignal,
  probes: string[],
): Promise<void> {
  const knowledge = ctx.get('knowledge') as KnowledgeLike | undefined
  const search = knowledge?.search
  if (knowledge === undefined || typeof search !== 'function') {
    probes.push('知识库未安装（dsh-knowledge-sqlite），跨会话回顾已跳过')
    return
  }
  // Resolve the command's agent so the knowledge caller can derive identity.
  const agents = ctx.get('agents') as
    | { get?(id: string): unknown; withInitiator?<T>(agent: unknown, operation: () => T): T }
    | undefined
  const agent = agents?.get?.(agentId ?? '')
  const withInitiator = agents?.withInitiator
  if (agents === undefined || agent === undefined || typeof withInitiator !== 'function') {
    probes.push('跨会话回顾：无法定位 agent 身份（已跳过）')
    return
  }
  try {
    // withInitiator 是 agents 服务方法，内部用 this.activeInitiatorRuns 等
    // 实例状态——必须保留 this（.call(agents, …)）。解构后直接调用会丢
    // this 并在 runWithInitiator 里抛「Cannot read properties of undefined」。
    // knowledge.search 同理：内部用 this.readCaller()，也必须 .call(knowledge)。
    const result = await withInitiator.call(agents, agent, () =>
      search.call(knowledge, SNAPSHOT_QUERY, { expand: false, signal }),
    ) as { hits?: Array<{ content?: string; createdAt?: number; dedupeKey?: string | null }> }
    const hit = result?.hits?.find(h => h !== undefined && typeof h.content === 'string' && h.content.length > 0)
    const content = hit?.content
    if (hit === undefined || content === undefined || content === '') {
      probes.push('知识库已安装，但未找到历史交接快照（首个 /compass 尚无回顾）')
      return
    }
    // 只取快照段本身（search 可能截断/混入其他内容）：截到固定标识行。
    const idx = content.indexOf(KNOWLEDGE_SNAPSHOT_KEY)
    const body = idx >= 0 ? content.slice(idx) : content
    // 只保留语义键值行：跳过 `---` / 标识行 / timestamp（回顾要简短可读）。
    const keyLines = body.split('\n')
      .map(l => l.trim())
      .filter(l => l !== '' && l !== SNAPSHOT_SEPARATOR && !l.includes(KNOWLEDGE_SNAPSHOT_KEY) && !/^timestamp:/.test(l))
    const when = typeof hit.createdAt === 'number' && hit.createdAt > 0
      ? new Date(hit.createdAt).toISOString().slice(0, 10)
      : '上次'
    const brief = keyLines.join(' | ').slice(0, 160)
    probes.push(`跨会话回顾（${when}）：${brief || '历史交接快照'}${keyLines.join(' | ').length > 160 ? '…' : ''}`)
  } catch (e) {
    const why = e instanceof Error && e.message ? e.message : String(e)
    probes.push(`跨会话回顾：检索失败（已跳过：${why.slice(0, 120)}）`)
  }
}
