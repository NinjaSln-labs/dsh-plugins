/**
 * dsh-session-health — Host half.
 *
 * Provides `ctx.sessionHealth` (a Typert Remote service the browser badge calls)
 * and the `/health` slash command (full textual report).
 *
 * Data sources (all read-only, all real):
 * - ctx.tokenMeter.measure(session) — exact per-round input pressure
 * - llm.resolveModelInfo — model context window
 * - sessionQuery.listEvents — message/turn counts
 * - fs + sandboxPolicy — optional git / handoff-doc probes
 */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import type { Session } from '@deepseek-ai/dsh-session'
import { HealthStateRequest, HealthStateResult } from './types.ts'

/** Compact token formatting: 123456 -> 123K, 1000000 -> 1M. */
function compact(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000
    return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + 'M'
  }
  if (n >= 1000) return Math.round(n / 1000) + 'K'
  return String(n)
}

/** Read the current model's context window through the session's route. */
async function resolveWindow(
  ctx: Context,
  session: Session,
): Promise<number | null> {
  const agentDefaultModel = ctx.get('agentDefaultModel')
  const llm = ctx.get('llm')
  if (agentDefaultModel === undefined || llm === undefined) return null
  try {
    const sel = agentDefaultModel.currentSelection()
    const info = await llm.resolveModelInfo(sel.provider, sel.model)
    return info.context ? info.context.contextWindow : null
  } catch {
    return null
  }
}

/** Measure the session's current input pressure via tokenMeter. */
function measureTokens(ctx: Context, session: Session): number | null {
  const tokenMeter = ctx.get('tokenMeter')
  if (tokenMeter === undefined) return null
  try {
    return tokenMeter.measure(session).totalTokens
  } catch {
    return null
  }
}

/** The Remote service the browser badge calls. */
export class SessionHealthService extends TypertRemoteService {
  static inject = ['sessions']

  constructor(ctx: Context) {
    super(ctx, 'sessionHealth')
  }

  @Remote('healthState')
  async healthState(request: HealthStateRequest): Promise<HealthStateResult> {
    const sessions = this.ctx.get('sessions')
    if (sessions === undefined) return { color: 'green', ratio: null, total: null, window: null }
    const session = sessions.get(request.sessionId)
    if (session === undefined) return { color: 'green', ratio: null, total: null, window: null }
    const total = measureTokens(this.ctx, session)
    const window = await resolveWindow(this.ctx, session)
    const ratio = total !== null && window !== null ? total / window : null
    const color =
      ratio === null ? 'green'
      : ratio >= 0.8 ? 'red'
      : ratio >= 0.5 ? 'yellow'
      : 'green'
    return { color, ratio, total, window }
  }
}

export const name = 'dsh-session-health'

/** Host plugin: Remote service + /health command. */
export default function sessionHealthHost(): Plugin {
  return {
    inject: ['commands'],
    apply(ctx: Context) {
      const service = new SessionHealthService(ctx)
      ctx.provide('sessionHealth', service, true)

      ctx.commands.register({
        name: 'health',
        description: '评估当前会话健康度（继续 vs 新开）。参数：minimal / no-git / no-handoff / doc=<交接文档文件名>',
        handler: async (invocation) => {
          const { agent, signal, rawInput } = invocation
          const session = agent.session
          if (session === undefined) return { kind: 'error', text: '无法定位当前会话。' }

          const arg = (rawInput || '').trim()
          const minimal = arg === 'minimal'
          const noGit = minimal || arg.includes('no-git')
          const noHandoff = minimal || arg.includes('no-handoff')
          const docMatch = arg.match(/doc=(\S+)/)
          const docName = docMatch ? docMatch[1] : null

          let cwd: string | null = null
          const sandboxPolicy = ctx.get('sandboxPolicy')
          if (sandboxPolicy !== undefined) cwd = sandboxPolicy.workspaceRoot
          if (cwd === null || cwd === undefined) {
            try { cwd = session.header.cwd ?? null } catch { cwd = null }
          }

          const total = measureTokens(ctx, session)
          const window = await resolveWindow(ctx, session)
          const ratio = total !== null && window !== null ? total / window : null

          // Event counts
          let counts: { total: number; user: number; turns: number; assistant: number } | null = null
          const sessionQuery = ctx.get('sessionQuery')
          if (sessionQuery !== undefined) {
            try {
              const events = await sessionQuery.listEvents(agent.id)
              let user = 0, turns = 0, assistant = 0
              for (const e of events) {
                const t = (e as { type?: string }).type ?? (e as { event?: { type?: string } }).event?.type ?? ''
                if (t === 'user/message') user++
                else if (t === 'turn/start') turns++
                else if (t === 'assistant/message') assistant++
              }
              counts = { total: events.length, user, turns, assistant }
            } catch { counts = null }
          }

          // Optional probes: git + user-named handoff doc
          const fs = ctx.get('fs')
          const probes: string[] = []
          if (cwd !== null && fs !== undefined) {
            if (!noGit) {
              let isGit = false
              try {
                const t = await fs.resolve('.git', { cwd, signal })
                isGit = (await fs.stat(t, signal)) !== undefined
              } catch { isGit = false }
              probes.push(isGit ? 'git 仓库：早期工作可追溯' : '非 git 工作区：恢复靠 DSH 会话记录')
            } else {
              probes.push('git 检查：已跳过')
            }
            if (!noHandoff) {
              if (docName !== null) {
                let found = false
                try {
                  const t = await fs.resolve(docName, { cwd, signal })
                  found = (await fs.stat(t, signal)) !== undefined
                } catch { found = false }
                probes.push(found ? '交接文档：已就位' : '交接文档：未找到你指定的文件')
              } else {
                probes.push('交接文档：未指定（可用 /health doc=文件名 检查）')
              }
            } else {
              probes.push('交接文档检查：已跳过')
            }
          }

          const high = (ratio !== null && ratio >= 0.5) || (total !== null && total >= 50000)
          let color: string, first: string, reason: string
          if (high) {
            color = '**黄**'
            first = '**建议在任务边界收尾**'
            if (ratio !== null && ratio >= 0.5) {
              reason = `上下文已占窗口 ${Math.round(ratio * 100)}%，早期内容开始被压缩；若剩余工作还多，开新会话更划算。`
            } else {
              reason = `每轮历史输入约 ${total} token，剩余轮数多则费用可观；若工作还多，开新会话更划算。`
            }
          } else {
            color = '**绿**'
            first = '**放心继续**'
            if (ratio !== null) reason = `上下文只用了窗口的 ${Math.round(ratio * 100)}%，空间充足，没有切换的必要。`
            else if (total !== null) reason = `每轮输入约 ${total} token，经济很轻，没有切换的必要。`
            else reason = '各项信号正常，没有切换的必要。'
          }

          const detail: string[] = []
          if (counts !== null && counts.turns > 0) {
            detail.push(`会话规模：${counts.turns} 轮 / ${counts.user} 条消息 / ${counts.assistant} 条回复`)
          }
          if (total !== null) {
            detail.push(`每轮输入约 ${compact(total)} token${ratio !== null ? `（窗口 ${Math.round(ratio * 100)}%）` : ''}${window !== null ? `；窗口 ${compact(window)}` : ''}`)
          }
          detail.push(...probes)
          if (minimal) detail.push('minimal 模式：仅核心指标')

          const text = [first + `（健康度：${color}）`, '', reason, '', '详情：', ...detail.map(d => '- ' + d)].join('\n')
          return { kind: 'success', text }
        },
      })
    },
  }
}
