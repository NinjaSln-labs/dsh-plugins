/**
 * dsh-context-compass — the /health command.
 *
 * User-initiated full textual report: first-line action + severity, reason,
 * details (scale, per-round cost, window ratio, compaction, probes), and a
 * switch-readiness checklist when yellow/red. No emoji (cross-platform
 * consistent), no HTML — the renderer emits markdown text.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { readConfig, type ConfigSource } from './config.ts'
import { assess, type HealthReport } from './assess.ts'
import { buildSnapshotText } from './knowledge.ts'
import { PERIOD_LABEL, formatCny, formatCompact, formatHitRate, formatUsd } from './util.ts'
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
  if (typeof s.turns === 'number') {
    lines.push(`- 会话规模：${s.turns} 轮 / ${s.userMessages ?? 0} 条消息 / ${s.assistantMessages ?? 0} 条回复`)
  }
  if (typeof s.total === 'number') {
    lines.push(`- 每轮输入约 ${formatCompact(s.total)} token${s.ratio !== null ? `（窗口 ${Math.min(Math.round(s.ratio * 100), 100)}%）` : ''}${s.window !== null ? `；窗口 ${formatCompact(s.window)}` : ''}`)
  }
  if (typeof s.cacheHitRate === 'number') {
    lines.push(`- 缓存命中率 ${formatHitRate(s.cacheHitRate)}（上次请求——命中高说明上下文稳定且便宜；压缩会重置命中）`)
  }
  if (s.effectivePerRoundCny !== null && s.effectivePerRoundCny !== undefined && s.effectivePerRoundUsd !== null && s.effectivePerRoundUsd !== undefined) {
    lines.push(`- 计费预期：约 ${formatCny(s.effectivePerRoundCny)}/轮（≈${formatUsd(s.effectivePerRoundUsd)}；输入价 ¥${s.inputMissPerMCny ?? 0}/M / $${s.inputMissPerMUsd ?? 0} ${s.pricePeriod !== null ? PERIOD_LABEL[s.pricePeriod] : ''}，缓存命中 ¥${s.inputHitPerMCny ?? 0}/M / $${s.inputHitPerMUsd ?? 0}，不含输出）`)
  } else if (s.effectivePerRoundUsd !== null && s.effectivePerRoundUsd !== undefined) {
    lines.push(`- 计费预期：约 ${formatUsd(s.effectivePerRoundUsd)}/轮（输入价 $${s.inputPricePerM ?? 0}/M 估算，缓存命中按折扣计，不含输出）`)
  }
  if (s.expectedTotalCny !== null && s.expectedTotalCny !== undefined && s.expectedTotalUsd !== null && s.expectedTotalUsd !== undefined && s.expectedTotalTokens !== null && s.expectedTotalTokens !== undefined) {
    lines.push(`- 剩余轮数输入费用预期 ≈ ${formatCny(s.expectedTotalCny)}（≈${formatUsd(s.expectedTotalUsd)}；约 ${formatCompact(s.expectedTotalTokens)} token 计费当量）`)
  } else if (s.expectedTotalUsd !== null && s.expectedTotalUsd !== undefined && s.expectedTotalTokens !== null && s.expectedTotalTokens !== undefined) {
    lines.push(`- 剩余轮数输入费用预期 ≈ ${formatUsd(s.expectedTotalUsd)}（约 ${formatCompact(s.expectedTotalTokens)} token 计费当量）`)
  }
  if (s.compactions > 0) {
    const ratioNote = typeof s.compactionRatio === 'number' && Number.isFinite(s.compactionRatio)
      ? `（上次压缩比例 ≈ ${Math.round(s.compactionRatio * 100)}%，按压缩前后压力快照差值推断——快照口径，非精确统计）`
      : ''
    lines.push(`- 已压缩 ${s.compactions} 次：早期细节概要化${ratioNote}`)
  }
  lines.push(...report.probes.map(p => '- ' + p))
  if (report.recommendation === 'danger-zone') {
    lines.push('- **注意**：当前工作依赖早期内容且决策依据未记录——切换前必须先补交接（文档 + commit）')
  }
  if (opts.minimal) lines.push('minimal 模式：仅核心指标')

  if (report.severity === 'yellow' || report.severity === 'red') {
    const h = report.handoff
    const commitItem = h.uncommittedCount !== null
      ? h.uncommittedCount === 0
        ? `- [x] 未提交变更：0 个（最新 commit ${h.lastCommit ?? '未知'}）`
        : `- [ ] 未提交变更：${h.uncommittedCount} 个（最新 commit ${h.lastCommit ?? '未知'}）`
      : '- [ ] 未提交变更：无法自动检查（无 subprocess 或非 git 工作树）'
    const pushItem = h.branchLine !== null
      ? /ahead \d+/.test(h.branchLine)
        ? `- [ ] 已 push：${h.branchLine}`
        : `- [x] 已 push：分支与远程同步（${h.branchLine}）`
      : '- [ ] 已 push：无法自动检查'
    const handoffItem = h.hasHandoff === true
      ? '- [x] 交接文档：已就位'
      : h.hasHandoff === false
        ? '- [ ] 交接文档：未找到你指定的文件'
        : '- [ ] 交接文档：未配置或无法检查'
    const processItem = h.runningProcesses.length > 0
      ? `- [x] 运行中进程：${h.runningProcesses.join('、')}（切换前确认归属）`
      : h.processesChecked
        ? '- [x] 运行中进程：未发现工作区相关进程'
        : '- [ ] 运行中进程：未检查（dev server / 测试服务需自行确认）'
    lines.push('', '切换前检查（在任务边界处）：', commitItem, pushItem, handoffItem, processItem)
  }
  // 结构化交接快照（机器可摄取，固定键名；始终输出——任何记忆/知识插件
  // 与用户都能 grep/写入，不绑定具体知识库）。probes 里的跨会话回顾在上
  // 面 lines.push(...report.probes...) 已包含。
  lines.push('', buildSnapshotText(report))
  return lines.join('\n')
}

/** Build the command definition (C1: config may be a live source thunk, read at handler time). */
export function healthCommandDefinition(ctx: Context, configSource: ConfigSource): CommandDefinition {
  return {
    name: 'compass',
    description: '评估当前上下文状态（继续 vs 新开）。参数：minimal / no-git / no-handoff / doc=<交接文档文件名> / remaining=<预计剩余轮数> / processes',
    input: { hint: 'minimal | no-git | no-handoff | doc=<文件名> | remaining=<轮数> | processes' },
    handler: async (invocation) => {
      const config = readConfig(configSource)
      const session = invocation.agent.session
      if (session === undefined) return { kind: 'error', text: '无法定位当前会话。' }

      const arg = (invocation.rawInput || '').trim()
      const minimal = arg === 'minimal'
      const noGit = minimal || arg.includes('no-git')
      const noHandoff = minimal || arg.includes('no-handoff')
      const docMatch = arg.match(/doc=(\S+)/)
      const remMatch = arg.match(/remaining=(\d+)/)
      // 只接受纯数字（含 0）；非法输入（abc / 负数 / 空）→ null 不参与判定，
      // 避免 Number('abc')=NaN 污染费用预期（NaN 能通过 !== null 检查）。
      const rem = remMatch ? Number(remMatch[1]) : NaN
      const remaining = Number.isFinite(rem) && rem >= 0 ? rem : null

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
