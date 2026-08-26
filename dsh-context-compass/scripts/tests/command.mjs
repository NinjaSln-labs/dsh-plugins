/**
 * Smoke domain: /compass command (argument parsing + report text).
 *
 * `run()` holds the handler checks (monolith L832-909). The three pure
 * buildCommandText text-builder checks (monolith L1023-1087) sit AFTER the
 * tool domain in the original file, so they are exported as `runTextBuilder()`
 * and sequenced by the runner after tool.run() to keep global order identical.
 */
import assert from 'node:assert/strict'
import { assess } from '../../lib/assess.js'
import { buildCommandText } from '../../lib/command.js'
import { resolveConfig } from '../../lib/config.js'
import { check, config, signal, session, ctx, cmdDef } from './helpers.mjs'

export async function run() {
  await check('assess: non-finite remainingRounds is treated as not provided (no NaN money)', async () => {
    // NaN 能通过 `!== null` 检查——若直接参与乘法会产出 ¥NaN/$NaN。归一化后
    // expectedTotal 全 null，文案无 NaN。
    const report = await assess(ctx, session, 'agent-1', signal, config, { remainingRounds: NaN })
    assert.equal(report.signals.expectedTotalTokens, null)
    assert.equal(report.signals.expectedTotalUsd, null)
    assert.equal(report.signals.expectedTotalCny, null)
    const text = buildCommandText(report, { minimal: false })
    assert.ok(!text.includes('NaN'), `NaN must never leak into the report: ${text}`)
  })

  await check('command: remaining=<illegal> parses to null, never NaN', async () => {
    for (const raw of ['remaining=abc', 'remaining=-5', 'remaining=', 'remaining=1e9', 'remaining=0']) {
      const result = await cmdDef.handler({ agent: { id: 'agent-1', session }, rawInput: raw, signal })
      assert.equal(result.kind, 'success')
      assert.ok(!result.text.includes('NaN'), `${raw} must not leak NaN`)
    }
    // 精确断言：非法 remaining 按未提供处理 → expectedTotal 全 null（不进
    // 费用预期行），而不是产生 NaN 或错误金额。
    const nanReport = await assess(ctx, session, 'agent-1', signal, config, { remainingRounds: Number('not-a-number') })
    assert.equal(nanReport.signals.expectedTotalTokens, null)
    assert.equal(nanReport.signals.expectedTotalUsd, null)
    assert.equal(nanReport.signals.expectedTotalCny, null)
  })

  await check('command: full report text', async () => {
    const result = await cmdDef.handler({ agent: { id: 'agent-1', session }, rawInput: '', signal })
    assert.equal(result.kind, 'success')
    assert.ok(result.text.includes('健康度：**黄**'))
    assert.ok(result.text.includes('详情'))
    assert.ok(result.text.includes('切换前检查'))
  })

  await check('command: minimal mode', async () => {
    const result = await cmdDef.handler({ agent: { id: 'agent-1', session }, rawInput: 'minimal', signal })
    assert.equal(result.kind, 'success')
    assert.ok(result.text.includes('minimal 模式'))
    assert.ok(!result.text.includes('git 仓库'))
  })

  await check('command: explicit no-git / no-handoff parameters skip those probes', async () => {
    const noGit = await cmdDef.handler({ agent: { id: 'agent-1', session }, rawInput: 'no-git', signal })
    assert.equal(noGit.kind, 'success')
    assert.ok(noGit.text.includes('git 检查：已跳过'))
    assert.ok(!noGit.text.includes('git 仓库：'), 'no-git 不得运行 git 探测')
    const noHandoff = await cmdDef.handler({ agent: { id: 'agent-1', session }, rawInput: 'no-handoff', signal })
    assert.equal(noHandoff.kind, 'success')
    assert.ok(noHandoff.text.includes('交接文档检查：已跳过'))
    assert.ok(noHandoff.text.includes('git 仓库：早期工作可追溯'), 'no-handoff 只跳过 handoff，git 仍探测')
  })

  await check('assess: config-disabled git/handoff annotate the skip (symmetric with processes)', async () => {
    const offCfg = resolveConfig({ checks: { git: { enabled: false }, handoff: { enabled: false } } })
    const report = await assess(ctx, session, 'agent-1', signal, offCfg, {})
    assert.ok(report.probes.some(p => p.includes('git 检查：已跳过（配置关闭）')), `got: ${JSON.stringify(report.probes)}`)
    assert.ok(report.probes.some(p => p.includes('交接文档检查：已跳过（配置关闭）')), `got: ${JSON.stringify(report.probes)}`)
  })

  await check('command: doc= parameter probes a user-named handoff file', async () => {
    const result = await cmdDef.handler({ agent: { id: 'agent-1', session }, rawInput: 'doc=HANDOFF.md', signal })
    assert.equal(result.kind, 'success')
    assert.ok(result.text.includes('交接文档：已就位'))
  })

  await check('assess: unsafe handoff paths (absolute / .. escape) are skipped, never probed', async () => {
    // docName / config.paths 可被提示注入引导到 cwd 之外——白名单拒绝并标注。
    const unsafe = await assess(ctx, session, 'agent-1', signal, config, { docName: '/etc/passwd' })
    assert.ok(unsafe.probes.some(p => p.includes('已跳过不安全路径')), `got: ${JSON.stringify(unsafe.probes)}`)
    assert.equal(unsafe.handoff.hasHandoff, null)
    const dotdot = await assess(ctx, session, 'agent-1', signal, config, { docName: '../../secret.md' })
    assert.ok(dotdot.probes.some(p => p.includes('已跳过不安全路径')))
    // 相对子目录路径（如 docs/HANDOFF.md）仍允许。
    const relCfg = resolveConfig({ checks: { handoff: { paths: ['docs/HANDOFF.md'] } } })
    const rel = await assess(ctx, session, 'agent-1', signal, relCfg, {})
    assert.ok(!rel.probes.some(p => p.includes('已跳过不安全路径')), `got: ${JSON.stringify(rel.probes)}`)
  })

  await check('command: no session degrades to error', async () => {
    const result = await cmdDef.handler({ agent: { id: 'agent-1', session: undefined }, rawInput: '', signal })
    assert.equal(result.kind, 'error')
  })
}

/** Monolith L1023-1087 — runs after the tool domain to preserve global order. */
export async function runTextBuilder() {
  await check('buildCommandText: blue tier wording', () => {
    const text = buildCommandText({
      severity: 'blue',
      recommendation: 'continue-with-note',
      summary: 'x',
      reason: '上下文占用 42%（中等）——继续没问题，留意窗口压力。',
      signals: { total: 420_000, window: 1_000_000, ratio: 0.42, turns: 8, userMessages: 10, assistantMessages: 9, compactions: 1, compactionRatio: null },
      probes: [],
      handoff: { isGitRepo: null, hasHandoff: null, runningProcesses: [] },
    }, { minimal: false })
    assert.ok(text.includes('健康度：**蓝**'))
    assert.ok(text.includes('已压缩 1 次'))
    assert.ok(!text.includes('切换前检查')) // blue: no switch checklist
  })

  await check('buildCommandText: compression ratio line with caliber note', () => {
    const text = buildCommandText({
      severity: 'yellow',
      recommendation: 'suggest-switch',
      summary: 'x',
      reason: 'r',
      signals: { total: 600_000, window: 1_000_000, ratio: 0.6, turns: 20, userMessages: 30, assistantMessages: 29, compactions: 2, compactionRatio: 0.42 },
      probes: [],
      handoff: { isGitRepo: null, hasHandoff: null, runningProcesses: [] },
    }, { minimal: false })
    assert.ok(text.includes('- 已压缩 2 次：早期细节概要化（上次压缩比例 ≈ 42%，按压缩前后压力快照差值推断——快照口径，非精确统计）'))
    // Defensive: an unknown ratio must not render NaN.
    const unknown = buildCommandText({
      severity: 'yellow', recommendation: 'suggest-switch', summary: 'x', reason: 'r',
      signals: { total: 1, window: 1, ratio: 1, turns: 1, userMessages: 1, assistantMessages: 1, compactions: 1 },
      probes: [],
      handoff: { isGitRepo: null, hasHandoff: null, runningProcesses: [] },
    }, { minimal: false })
    assert.ok(unknown.includes('已压缩 1 次：早期细节概要化'))
    assert.ok(!unknown.includes('NaN'))
  })

  await check('knowledge: snapshot block appended to the report (fixed keys, grep-able)', () => {
    const text = buildCommandText({
      severity: 'yellow',
      recommendation: 'suggest-switch',
      summary: 'x',
      reason: 'r',
      signals: { total: 600_000, window: 1_000_000, ratio: 0.6, turns: 20, userMessages: 30, assistantMessages: 29, compactions: 2, compactionRatio: 0.42 },
      probes: [],
      handoff: { isGitRepo: true, hasHandoff: false, runningProcesses: [], uncommittedCount: 3, lastCommit: 'abc' },
    }, { minimal: false })
    assert.ok(text.includes('交接快照（context-compass-handoff-snapshot）'))
    assert.ok(text.includes('severity: yellow'))
    assert.ok(text.includes('recommendation: suggest-switch'))
    assert.ok(text.includes('compacted: 2'))
    assert.ok(text.includes('compression_ratio: 42'))
    assert.ok(text.includes('uncommitted: 3'))
    assert.ok(text.includes('handoff_ready: false'))
    assert.ok(/timestamp: \d{4}-\d{2}-\d{2}T/.test(text))
    // No compactions → the compacted/compression keys are omitted, others stay.
    const noCompact = buildCommandText({
      severity: 'green', recommendation: 'continue', summary: 'x', reason: 'r',
      signals: { total: 10_000, window: 1_000_000, ratio: 0.01, turns: 2, userMessages: 3, assistantMessages: 2, compactions: 0 },
      probes: [], handoff: { isGitRepo: null, hasHandoff: null, runningProcesses: [] },
    }, { minimal: true })
    assert.ok(noCompact.includes('severity: green'))
    assert.ok(!noCompact.includes('compacted:'))
    assert.ok(!noCompact.includes('compression_ratio:'))
  })
}
