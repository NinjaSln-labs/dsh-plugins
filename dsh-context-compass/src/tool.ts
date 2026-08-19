/**
 * dsh-context-compass — the context_compass tool.
 *
 * Model-callable read-only assessment: the model self-checks the work-nature
 * questions (1a dependsOnEarly / 1b earlyDecisionRecorded / 4 remainingRounds)
 * while the host measures everything else exactly. Returns a structured
 * verdict + signals + handoff readiness; a full markdown report rides along
 * when the threshold tier is reached. No ask-gating, no side effects.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ResolvedConfig } from './config.ts'
import { assess } from './assess.ts'
import { buildCommandText } from './command.ts'

const PARAMETERS = {
  reason: {
    type: 'string',
    description: '触发原因（可选；写入调用上下文，便于追溯为什么自查）',
  },
  remainingRounds: {
    type: 'integer',
    description: '预计剩余轮数（可选；用于经济评估：剩余轮数多且每轮输入大时，开新会话更省钱）',
  },
  dependsOnEarly: {
    type: 'boolean',
    description: '工作性质自查 1a：当前工作是否依赖会话早期（压缩线以前）的内容？大型重构/优化为 true（可选）',
  },
  earlyDecisionRecorded: {
    type: 'boolean',
    description: '工作性质自查 1b：早期决策依据/命名约定/数字是否已被 git 或文档记录？（可选；dependsOnEarly 为 true 时强烈建议提供）',
  },
  handoffDoc: {
    type: 'string',
    description: '交接文档文件名（可选；用于恢复能力检查，与 /compass doc= 一致）',
  },
} as const

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    severity: {
      type: 'string',
      required: true,
      enum: ['green', 'blue', 'yellow', 'red'],
      description: '健康度：绿=放心继续，蓝=继续但留意，黄=建议任务边界收尾，红=危险区尽快收尾',
    },
    recommendation: {
      type: 'string',
      required: true,
      enum: ['continue', 'continue-with-note', 'suggest-switch', 'danger-zone'],
      description: '二维判定结论（继续成本 × 切换成本）',
    },
    summary: { type: 'string', required: true, description: '一句话结论' },
    report: { type: 'string', description: '黄/红档位的完整报告（markdown 文本）' },
    signals: {
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: {
        windowPercent: { type: 'number', description: '每轮输入占模型窗口百分比（未知时省略）' },
        tokensPerRound: { type: 'number', description: '每轮输入 token 数（未知时省略）' },
        turns: { type: 'number', description: '会话轮次' },
        messageCount: { type: 'number', description: '消息总数（用户 + 助手）' },
        compactions: { type: 'number', required: true, description: '已压缩次数（0 表示从未压缩；恒存在）' },
        compactionRatio: { type: 'number', description: '上次压缩比例 0..1（按压缩前后压力快照差值推断——快照口径，非精确统计；未知时省略）' },
      },
    },
    handoffReady: {
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: {
        isGitRepo: { type: 'boolean', description: '工作区是否为 git 仓库（未知时省略）' },
        clean: { type: 'boolean', description: 'git 工作树是否干净（0 个未提交变更；未知时省略）' },
        uncommittedCount: { type: 'integer', description: '未提交变更数（未知时省略）' },
        lastCommit: { type: 'string', description: '最新 commit 行（未知时省略）' },
        /** git 分支与远程同步状态（`git status -sb` 首行，如 `## main...origin/main [ahead 2]`）——交接清单的 push 项；未知时省略。 */
        branchLine: { type: 'string', description: 'git 分支与远程同步状态（未 push 提交在切换前需推送；未知时省略）' },
        hasHandoff: { type: 'boolean', description: '交接文档是否就位（未知时省略）' },
        runningProcesses: { type: 'array', items: { type: 'string' }, description: '工作区相关运行中进程（名称）' },
      },
    },
    cost: {
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: {
        cacheHitRate: { type: 'number', description: '会话累计缓存命中率 0..1（与输入栏统计同口径；未知时省略）' },
        effectivePerRound: { type: 'number', description: '每轮计费当量 token（未缓存输入 + 缓存命中×折扣；未知时省略）' },
        effectivePerRoundUsd: { type: 'number', description: '每轮计费当量金额 USD（未知时省略）' },
        effectivePerRoundCny: { type: 'number', description: '每轮计费当量金额 CNY（官方峰谷定价文档激活时；未知时省略）' },
        inputPricePerM: { type: 'number', description: '输入价格基准（USD / 1M token）' },
        inputMissPerMCny: { type: 'number', description: '官方 CNY 未命中输入价 /1M（静态模式省略）' },
        inputHitPerMCny: { type: 'number', description: '官方 CNY 缓存命中输入价 /1M（静态模式省略）' },
        inputMissPerMUsd: { type: 'number', description: '官方 USD 未命中输入价 /1M' },
        inputHitPerMUsd: { type: 'number', description: '官方 USD 缓存命中输入价 /1M' },
        pricePeriod: { type: 'string', enum: ['peak', 'offpeak'], description: '当前忙/闲时段（北京时间；静态模式省略）' },
        remainingRounds: { type: 'integer', description: '本次调用提供的剩余轮数（未提供时省略）' },
        expectedTotalTokens: { type: 'number', description: '剩余轮数输入费用预期 token（= effectivePerRound × remainingRounds；未知时省略）' },
        expectedTotalUsd: { type: 'number', description: '剩余轮数输入费用预期 USD（未知时省略）' },
        expectedTotalCny: { type: 'number', description: '剩余轮数输入费用预期 CNY（未知时省略）' },
      },
    },
  },
} as const

/** Replay-safe text projection of the canonical result value. */
function renderToolText(value: {
  summary?: string
  report?: string
  signals?: { windowPercent?: number; tokensPerRound?: number; turns?: number; messageCount?: number; compactions?: number; compactionRatio?: number }
}): string {
  if (value.report !== undefined && value.report.length > 0) return value.report
  const s = value.signals
  if (s === undefined) return value.summary ?? '上下文罗盘评估完成。'
  const parts: string[] = [value.summary ?? '']
  if (s.windowPercent !== undefined) parts.push(`窗口占用 ${s.windowPercent}%`)
  if (s.tokensPerRound !== undefined) parts.push(`每轮输入 ${s.tokensPerRound} token`)
  if (s.turns !== undefined) parts.push(`${s.turns} 轮`)
  if (s.messageCount !== undefined) parts.push(`${s.messageCount} 条消息`)
  if ((s.compactions ?? 0) > 0) {
    const ratioNote = typeof s.compactionRatio === 'number'
      ? `（上次压缩比例约 ${Math.round(s.compactionRatio * 100)}%，快照口径）`
      : ''
    parts.push(`已压缩 ${s.compactions} 次${ratioNote}`)
  }
  return parts.filter(Boolean).join('；') + '。如需完整报告可让用户运行 /compass。'
}

/** Build the model-facing tool (config closed over at mount time). */
export function sessionHealthTool(ctx: Context, config: ResolvedConfig): ToolDefinition {
  return defineTool({
    name: 'context_compass',
    description: '评估当前上下文状态（继续 vs 新开）：真实 token 测量 + 窗口占比 + 切换成本提示。长任务中自查用，只读、无副作用；若建议切换，请把报告交给用户决定。',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderToolText(value as Parameters<typeof renderToolText>[0]) }],
    },
    timeoutMs: 15_000,
    execute: async (args, exec) => {
      const session = exec.agent?.session
      if (session === undefined) {
        throw new Error('无法定位当前会话（context_compass 仅在会话上下文中可用）')
      }
      const report = await assess(ctx, session, exec.agent?.id, exec.signal, config, {
        docName: args.handoffDoc ?? null,
        checkProcesses: true,
        remainingRounds: args.remainingRounds ?? null,
        dependsOnEarly: args.dependsOnEarly,
        earlyDecisionRecorded: args.earlyDecisionRecorded,
      })
      const signals: {
        windowPercent?: number
        tokensPerRound?: number
        turns?: number
        messageCount?: number
        compactions: number
        compactionRatio?: number
      } = { compactions: report.signals.compactions }
      if (report.signals.ratio !== null) signals.windowPercent = Math.round(report.signals.ratio * 100)
      if (report.signals.total !== null) signals.tokensPerRound = report.signals.total
      if (report.signals.turns !== null) signals.turns = report.signals.turns
      if (report.signals.userMessages !== null || report.signals.assistantMessages !== null) {
        signals.messageCount = (report.signals.userMessages ?? 0) + (report.signals.assistantMessages ?? 0)
      }
      if (report.signals.compactionRatio !== null) signals.compactionRatio = report.signals.compactionRatio

      const handoffReady: Record<string, unknown> = { runningProcesses: report.handoff.runningProcesses }
      if (report.handoff.isGitRepo !== null) handoffReady.isGitRepo = report.handoff.isGitRepo
      if (report.handoff.clean !== null) handoffReady.clean = report.handoff.clean
      if (report.handoff.uncommittedCount !== null) handoffReady.uncommittedCount = report.handoff.uncommittedCount
      if (report.handoff.lastCommit !== null) handoffReady.lastCommit = report.handoff.lastCommit
      // push 状态（ahead/behind）也是交接清单的真实部分——未 push 的提交在
      // 切换前需推送。与 buildHandoffSummary 的 branchLine 同源（B3 修复）。
      if (report.handoff.branchLine !== null) handoffReady.branchLine = report.handoff.branchLine
      if (report.handoff.hasHandoff !== null) handoffReady.hasHandoff = report.handoff.hasHandoff

      const cost: Record<string, number | string> = {}
      if (report.signals.cacheHitRate !== null) cost.cacheHitRate = report.signals.cacheHitRate
      if (report.signals.effectivePerRound !== null) cost.effectivePerRound = report.signals.effectivePerRound
      if (report.signals.effectivePerRoundUsd !== null) cost.effectivePerRoundUsd = report.signals.effectivePerRoundUsd
      if (report.signals.effectivePerRoundCny !== null) cost.effectivePerRoundCny = report.signals.effectivePerRoundCny
      cost.inputPricePerM = report.signals.inputPricePerM
      if (report.signals.inputMissPerMCny !== null) cost.inputMissPerMCny = report.signals.inputMissPerMCny
      if (report.signals.inputHitPerMCny !== null) cost.inputHitPerMCny = report.signals.inputHitPerMCny
      cost.inputMissPerMUsd = report.signals.inputMissPerMUsd
      cost.inputHitPerMUsd = report.signals.inputHitPerMUsd
      if (report.signals.pricePeriod !== null) cost.pricePeriod = report.signals.pricePeriod
      if (args.remainingRounds !== undefined) cost.remainingRounds = args.remainingRounds
      if (report.signals.expectedTotalTokens !== null) cost.expectedTotalTokens = report.signals.expectedTotalTokens
      if (report.signals.expectedTotalUsd !== null) cost.expectedTotalUsd = report.signals.expectedTotalUsd
      if (report.signals.expectedTotalCny !== null) cost.expectedTotalCny = report.signals.expectedTotalCny

      return {
        severity: report.severity,
        recommendation: report.recommendation,
        summary: report.summary,
        ...(report.severity === 'yellow' || report.severity === 'red'
          ? { report: buildCommandText(report, { minimal: false }) }
          : {}),
        signals,
        handoffReady,
        cost,
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: '评估上下文状态',
      kind: 'read',
      rawInput: args.reason ?? '',
    }),
  })
}
