/**
 * dsh-session-health — the /health command.
 *
 * User-initiated full textual report: first-line action + severity, reason,
 * details (scale, per-round cost, window ratio, compaction, probes), and a
 * switch-readiness checklist when yellow/red. No emoji (cross-platform
 * consistent), no HTML — the renderer emits markdown text.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import type { ResolvedConfig } from './config.ts'
import { assess, type HealthReport } from './assess.ts'
import { formatCompact } from './util.ts'
import type { HealthSeverity } from './types.ts'

const SEVERITY_LABEL: Record<HealthSeverity, string> = {
  green: '绿',
  blue: '蓝',
  yellow: '黄',
  red: '红',
}

const FIRST_LINE: Record<HealthSeverity, string> = {
  green: '**放心继续**',
  blue: '**继续，留意窗口压力**',
  yellow: '**建议在任务边界收尾**',
  red: '**尽快收尾并交接**',
}

/** Project the assessment into the user-facing report text. */
export function buildCommandText(report: HealthReport, opts: { minimal: boolean }): string {
  const s = report.signals
  const lines = [
    FIRST_LINE[report.severity] + `（健康度：**${SEVERITY_LABEL[report.severity]}**）`,
    '',
    report.reason,
    '',
    '详情：',
  ]
  if (s.turns !== null) {
    lines.push(`- 会话规模：${s.turns} 轮 / ${s.userMessages ?? 0} 条消息 / ${s.assistantMessages ?? 0} 条回复`)
  }
  if (s.total !== null) {
    lines.push(`- 每轮输入约 ${formatCompact(s.total)} token${s.ratio !== null ? `（窗口 ${Math.round(s.ratio * 100)}%）` : ''}${s.window !== null ? `；窗口 ${formatCompact(s.window)}` : ''}`)
  }
  if (s.compactions > 0) {
    lines.push(`- 已压缩 ${s.compactions} 次：早期细节概要化（git 可追溯）`)
  }
  lines.push(...report.probes.map(p => '- ' + p))
  if (report.recommendation === 'danger-zone') {
    lines.push('- **注意**：当前工作依赖早期内容且决策依据未记录——切换前必须先补交接（文档 + commit）')
  }
  if (opts.minimal) lines.push('minimal 模式：仅核心指标')

  if (report.severity === 'yellow' || report.severity === 'red') {
    lines.push(
      '',
      '切换前检查（在任务边界处）：',
      '- [ ] 未提交变更已 commit / push',
      '- [ ] 交接文档已同步',
      report.handoff.runningProcesses.length > 0
        ? `- [ ] 运行中进程归属明确（${report.handoff.runningProcesses.join('、')}）`
        : '- [ ] 运行中进程归属明确（dev server / 测试服务）',
    )
  }
  return lines.join('\n')
}

/** Build the command definition (config closed over at mount time). */
export function healthCommandDefinition(ctx: Context, config: ResolvedConfig): CommandDefinition {
  return {
    name: 'health',
    description: '评估当前会话健康度（继续 vs 新开）。参数：minimal / no-git / no-handoff / doc=<交接文档文件名> / remaining=<预计剩余轮数> / processes',
    input: { hint: 'minimal | no-git | no-handoff | doc=<文件名> | remaining=<轮数> | processes' },
    handler: async (invocation) => {
      const session = invocation.agent.session
      if (session === undefined) return { kind: 'error', text: '无法定位当前会话。' }

      const arg = (invocation.rawInput || '').trim()
      const minimal = arg === 'minimal'
      const noGit = minimal || arg.includes('no-git')
      const noHandoff = minimal || arg.includes('no-handoff')
      const docMatch = arg.match(/doc=(\S+)/)
      const remMatch = arg.match(/remaining=(\d+)/)
      const remaining = remMatch ? Number(remMatch[1]) : null

      const report = await assess(ctx, session, invocation.agent.id, invocation.signal, config, {
        minimal,
        noGit,
        noHandoff,
        docName: docMatch ? docMatch[1] : null,
        checkProcesses: !minimal && (arg.includes('processes') || config.checks.processes.enabled),
        remainingRounds: remaining,
      })
      return { kind: 'success', text: buildCommandText(report, { minimal }) }
    },
  }
}
