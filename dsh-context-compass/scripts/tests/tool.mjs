/**
 * Smoke domain: context_compass tool (registration, execute verdicts, render).
 * Checks moved verbatim from the monolith (L916-1020); the shared `tool`
 * fixture (sessionHealthTool(ctx, config)) lives in helpers.mjs.
 */
import assert from 'node:assert/strict'
import { assess } from '../../lib/assess.js'
import { buildCommandText } from '../../lib/command.js'
import { sessionHealthTool } from '../../lib/tool.js'
import { check, config, signal, session, services, ctx, tool } from './helpers.mjs'

export async function run() {
  await check('tool: registers name + read kind', () => {
    assert.equal(tool.name, 'context_compass')
    assert.equal(tool.presentCall({ reason: 'x' }).kind, 'read')
  })

  await check('tool: execute returns structured verdict + report', async () => {
    const value = await tool.execute({ reason: '自检', remainingRounds: 12 }, {
      agent: { id: 'agent-1', session },
      signal,
    })
    // A3 经济升级：计费当量 300K ≥ max(50K, 0.3×1M)=300K 且剩余 12 ≥ 10 → yellow 升 red。
    assert.equal(value.severity, 'red')
    assert.equal(value.recommendation, 'suggest-switch')
    assert.equal(value.signals.windowPercent, 30)
    assert.equal(value.signals.tokensPerRound, 300_000)
    assert.equal(value.signals.messageCount, 3) // 2 user + 1 assistant in the stub events
    assert.equal(value.handoffReady.isGitRepo, true)
    assert.ok(typeof value.report === 'string' && value.report.length > 0)
  })

  await check('tool: A3 — remaining below floor keeps the economy tier at yellow', async () => {
    const low = await tool.execute({ reason: '自检', remainingRounds: 5 }, {
      agent: { id: 'agent-1', session },
      signal,
    })
    assert.equal(low.severity, 'yellow') // 剩余 5 < 10：不升级
    const none = await tool.execute({ reason: '自检' }, {
      agent: { id: 'agent-1', session },
      signal,
    })
    assert.equal(none.severity, 'yellow') // 未提供剩余轮数：不升级
  })

  await check('assess + tool: negative remainingRounds treated as not provided (no negative money)', async () => {
    // 第八轮：/compass 命令解析在入口拦截 `>= 0`，但工具路径直传 args——
    // assess 归一化必须与命令一致（isFinite && >= 0），否则负数产出负费用
    // 预期（-¥0.3 / -$0.04 污染工具输出）。直调 assess 与工具路径都必须拦住。
    const negReport = await assess(ctx, session, 'agent-1', signal, config, { remainingRounds: -3 })
    assert.equal(negReport.signals.expectedTotalTokens, null)
    assert.equal(negReport.signals.expectedTotalUsd, null)
    assert.equal(negReport.signals.expectedTotalCny, null)
    // 负数不参与经济升级（视同未提供）——黄色保持不进 red。
    assert.equal(negReport.severity, 'yellow')
    const negText = buildCommandText(negReport, { minimal: false })
    // 负货币金额的渲染签名是「货币符紧跟负号」——formatCny/formatUsd 对负值
    // 产出 ¥-0.30 / $-0.04。`[¥$]-` 精准覆盖它，又不会误伤版本号 "0.6-0"
    // 之类的 `数字-数字` 串。
    assert.ok(!/[¥$]-/.test(negText), 'negative money must never leak into the report')

    const negTool = await tool.execute({ reason: '自检', remainingRounds: -3 }, {
      agent: { id: 'agent-1', session },
      signal,
    })
    assert.equal(negTool.cost.remainingRounds, undefined) // 负数不回显
    assert.equal(negTool.cost.expectedTotalTokens, undefined)
    assert.equal(negTool.cost.expectedTotalUsd, undefined)
  })

  await check('tool: windowPercent clamped to 100 when ratio > 1', async () => {
    // ratio > 1 happens when pressure exceeds the known window (caliber gap).
    // The tool output must clamp the display percentage to 100 — same as the
    // assess/projection/command/client surfaces.
    const wideCtx = {
      get: name => {
        if (name === 'tokenMeter') return { measure: () => ({ totalTokens: 1_500_000 }) }
        if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) }
        if (name === 'llm') return { resolveModelInfo: async () => ({ context: { contextWindow: 1_000_000 } }) }
        return services[name]
      },
    }
    const wideTool = sessionHealthTool(wideCtx, config)
    const value = await wideTool.execute({ reason: 'wide' }, {
      agent: { id: 'agent-1', session },
      signal,
    })
    assert.equal(value.signals.windowPercent, 100) // clamped, never 150
  })

  await check('tool: danger-zone recommendation surfaces for the model', async () => {
    const value = await tool.execute({ dependsOnEarly: true }, {
      agent: { id: 'agent-1', session },
      signal,
    })
    assert.equal(value.recommendation, 'danger-zone')
  })

  await check('tool: render produces text from the canonical value', () => {
    const blocks = tool.output.render({}, {
      severity: 'yellow',
      recommendation: 'suggest-switch',
      summary: '建议在任务边界收尾',
      report: '# 报告',
      signals: {},
      handoffReady: {},
    })
    assert.equal(blocks[0].type, 'text')
    assert.ok(blocks[0].text.includes('# 报告'))
  })

  await check('tool: execute without session throws', async () => {
    await assert.rejects(
      () => tool.execute({}, { agent: undefined, signal }),
      /无法定位当前会话/,
    )
  })
}
