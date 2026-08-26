/**
 * Smoke domain: assess — the shared assess() core plus its probe suites:
 * git/handoff automation, processes probing, cost expectation and the
 * decoupled knowledge linkage. Checks moved verbatim from the monolith
 * (L338-613). Two checks that belong to other domains by name stay here to
 * preserve global order: `tool: handoffReady surfaces branchLine…` (L520) and
 * `command: explicit processes argument…` (L572).
 */
import assert from 'node:assert/strict'
import { assess } from '../../lib/assess.js'
import { buildCommandText, healthCommandDefinition } from '../../lib/command.js'
import { sessionHealthTool } from '../../lib/tool.js'
import { resolveConfig } from '../../lib/config.js'
import {
  check, config, signal, session, services, ctx,
  agentsStub, knowledgeHitCtx, GIT_OUT, gitCtx, psCtx,
} from './helpers.mjs'

export async function run() {
  await check('assess: non-finite tokenMeter / contextWindow readings are rejected', async () => {
    // tokenMeter 返回 NaN/Infinity（异常适配器）→ total null；llm 返回
    // Infinity 窗口 → window null——两者都不进 signals（NaN 能通过 typeof
    // number 检查，且 assess signals 不走 zod schema）。
    const nanCtx = {
      get: name => name === 'tokenMeter'
        ? { measure: () => ({ totalTokens: NaN }) }
        : name === 'llm'
          ? { resolveModelInfo: async () => ({ context: { contextWindow: Infinity } }) }
          : services[name],
    }
    const report = await assess(nanCtx, session, 'agent-1', signal, config, {})
    assert.equal(report.signals.total, null)
    assert.equal(report.signals.window, null)
    assert.equal(report.signals.ratio, null)
    const text = buildCommandText(report, { minimal: false })
    assert.ok(!text.includes('NaN'), `NaN must never leak: ${text}`)
  })

  await check('assess: economy yellow + probes + counts', async () => {
    const report = await assess(ctx, session, 'agent-1', signal, config, { docName: 'HANDOFF.md' })
    assert.equal(report.severity, 'yellow') // billable 300K >= max(50K, 0.3×1M) economy floor
    assert.equal(report.signals.turns, 2)
    assert.equal(report.signals.userMessages, 2)
    assert.equal(report.signals.total, 300_000)
    assert.equal(report.handoff.isGitRepo, true)
    assert.equal(report.handoff.hasHandoff, true)
    assert.equal(report.recommendation, 'suggest-switch')
    assert.ok(report.probes.some(p => p.includes('git 仓库')))
    assert.ok(report.probes.some(p => p.includes('交接文档：已就位')))
    assert.ok(report.probes.some(p => p.includes('缓存命中率 0%')))
  })

  await check('assess: compression ratio rides the fold snapshot + caliber probe', async () => {
    const report = await assess(ctx, session, 'agent-1', signal, config, {})
    assert.equal(report.signals.compactionRatio, 0.4)
    assert.ok(report.probes.some(p => p.includes('上次压缩比例 ≈ 40%') && p.includes('快照口径')))
    const text = buildCommandText(report, { minimal: false })
    assert.ok(text.includes('已压缩 1 次：早期细节概要化（上次压缩比例 ≈ 40%'))
  })

  await check('assess: danger-zone when work depends on unrecorded early content', async () => {
    const report = await assess(ctx, session, 'agent-1', signal, config, {
      dependsOnEarly: true,
      earlyDecisionRecorded: false,
    })
    assert.equal(report.recommendation, 'danger-zone')
    assert.ok(report.reason.includes('裸切'))
  })

  await check('assess: minimal skips probes', async () => {
    const report = await assess(ctx, session, 'agent-1', signal, config, { minimal: true })
    assert.ok(!report.probes.some(p => p.includes('git')))
    assert.ok(!report.probes.some(p => p.includes('交接')))
  })

  /* ---------- knowledge linkage (D2, decoupled) — stubs live in helpers ---------- */
  await check('knowledge: absent service degrades to a skip probe (no dependency)', async () => {
    const report = await assess(ctx, session, 'agent-1', signal, config, {})
    assert.ok(report.probes.some(p => p.includes('知识库未安装')))
    // 「跨会话回顾已跳过」是跳过行本身；真正的回顾行以「跨会话回顾（」开头。
    assert.ok(!report.probes.some(p => p.includes('跨会话回顾（')))
  })

  await check('knowledge: cross-session lookback from a mounted service', async () => {
    const report = await assess(knowledgeHitCtx, session, 'agent-1', signal, config, {})
    const note = report.probes.find(p => p.includes('跨会话回顾（'))
    assert.ok(note !== undefined, `expected lookback probe, got: ${JSON.stringify(report.probes)}`)
    assert.ok(note.includes('2026-08-16'))
    assert.ok(note.includes('severity: red'))
  })

  await check('knowledge: mounted but no resolvable agent → skip, never throws', async () => {
    const noAgentCtx = {
      get: name => name === 'knowledge'
        ? { search: async () => { throw new Error('should not be called') } }
        : name === 'agents'
          ? { get: () => undefined, withInitiator: (_a, op) => op() }
          : services[name],
    }
    const report = await assess(noAgentCtx, session, 'agent-1', signal, config, {})
    assert.ok(report.probes.some(p => p.includes('无法定位 agent 身份')))
  })

  await check('knowledge: search failure degrades, never throws', async () => {
    const failCtx = {
      get: name => name === 'knowledge'
        ? { search: async () => { throw new Error('boom') } }
        : name === 'agents'
          ? agentsStub
          : services[name],
    }
    const report = await assess(failCtx, session, 'agent-1', signal, config, {})
    assert.ok(report.probes.some(p => p.includes('检索失败')))
  })

  /* ---------- git-state automation + cost expectation — stubs live in helpers ---------- */
  await check('assess: git worktree state automates the handoff checklist', async () => {
    const report = await assess(gitCtx, session, 'agent-1', signal, config, {})
    assert.equal(report.handoff.clean, false)
    assert.equal(report.handoff.uncommittedCount, 2)
    assert.equal(report.handoff.lastCommit, '166f5ac feat: x')
    assert.ok(report.handoff.branchLine.includes('ahead 2'))
    assert.ok(report.probes.some(p => p.includes('git 工作树：2 个未提交变更')))
    const text = buildCommandText(report, { minimal: false })
    assert.ok(text.includes('- [ ] 未提交变更：2 个'))
    assert.ok(text.includes('- [ ] 已 push：## main...origin/main [ahead 2]'))
  })

  await check('assess: clean worktree marks the commit/push items done', async () => {
    const cleanOut = { ...GIT_OUT, 'status --short': '' }
    const cleanCtx = {
      get: name => (name === 'subprocess'
        ? {
          spawn: ({ argv }) => ({
            done: Promise.resolve({ exitCode: 0 }),
            collected: { stdout: { readFrom: () => ({ text: cleanOut[argv.slice(1).join(' ')] ?? '' }) } },
          }),
        }
        : services[name]),
    }
    const report = await assess(cleanCtx, session, 'agent-1', signal, config, {})
    assert.equal(report.handoff.clean, true)
    assert.equal(report.handoff.uncommittedCount, 0)
    assert.ok(report.probes.some(p => p.includes('git 工作树：干净')))
  })

  await check('tool: handoffReady surfaces branchLine (push state) from the git probe', async () => {
    // The tool's assess path reads the same subprocess seam as /compass — the
    // push state (ahead/behind) must reach the model through handoffReady.
    const gitTool = sessionHealthTool(gitCtx, config)
    const value = await gitTool.execute({}, {
      agent: { id: 'agent-1', session },
      signal,
    })
    assert.equal(value.handoffReady.branchLine, '## main...origin/main [ahead 2]')
    assert.equal(value.handoffReady.uncommittedCount, 2)
  })

  /* ---------- processes probe (default OFF, DESIGN §4.6) — psCtx lives in helpers ---------- */
  await check('assess: processes probe default OFF — /compass does not run ps unless enabled or requested', async () => {
    // DESIGN §4.6: 进程检测默认关闭（config.checks.processes.enabled=false），
    // 「关闭时跳过」。默认 /compass 不探测；显式 processes 参数才探测。
    // 默认（enabled=false）：/compass 不跑 ps → probe 明确标注「已跳过」
    // （与 git/handoff 对称），且无「发现」结果行。
    const report = await assess(psCtx, session, 'agent-1', signal, config, {})
    assert.ok(report.probes.some(p => p.includes('进程检测：已跳过')), `default must note the skip, got: ${JSON.stringify(report.probes)}`)
    assert.ok(!report.probes.some(p => p.includes('进程检测：发现')), `default must not probe, got: ${JSON.stringify(report.probes)}`)
    assert.equal(report.handoff.processesChecked, false)
    // 显式 checkProcesses=true（/compass processes / 工具路径）：探测并回报。
    const withProcs = await assess(psCtx, session, 'agent-1', signal, config, { checkProcesses: true })
    assert.equal(withProcs.handoff.processesChecked, true)
    assert.ok(withProcs.handoff.runningProcesses.length >= 1, `expected a dev-server marker, got: ${JSON.stringify(withProcs.handoff.runningProcesses)}`)
    assert.ok(withProcs.probes.some(p => p.includes('进程检测：发现')))
    // 用户配置 enabled=true：/compass 默认也探测（尊重配置）。
    const enabledCfg = resolveConfig({ checks: { processes: { enabled: true } } })
    const onByConfig = await assess(psCtx, session, 'agent-1', signal, enabledCfg, {})
    assert.ok(onByConfig.probes.some(p => p.includes('进程检测')), `config-enabled must probe, got: ${JSON.stringify(onByConfig.probes)}`)
  })

  await check('command: explicit processes argument probes even with default OFF', async () => {
    const cmdDef = healthCommandDefinition(psCtx, config)
    const result = await cmdDef.handler({ agent: { id: 'agent-1', session }, rawInput: 'processes', signal })
    assert.equal(result.kind, 'success')
    assert.ok(result.text.includes('进程检测：发现'))
  })

  await check('assess: cost expectation from cache-effective per-round', async () => {
    const costCtx = {
      get: name => {
        if (name === 'sessionProjections') {
          return {
            snapshot: () => ({
              values: {
                sessionHealth: {
                  severity: 'yellow', advice: 'a', ratio: 0.13, total: 132_000, window: 1_000_000,
                  turns: 2, userMessages: 2, assistantMessages: 1, compactions: 0,
                  uncachedInputTokens: 13_200, cacheReadTokens: 118_800,
                  effectivePerRound: 25_080, // 13200 + 118800*0.1
                  effectivePerRoundUsd: (25_080 * 0.28) / 1_000_000, // $0.007/轮
                },
                tokenUsage: { uncachedInputTokens: 13_200, cacheReadTokens: 118_800, cacheWriteTokens: 0 },
              },
            }),
          }
        }
        return services[name]
      },
    }
    const report = await assess(costCtx, session, 'agent-1', signal, config, { remainingRounds: 10 })
    assert.equal(report.signals.cacheHitRate, 0.9)
    assert.equal(report.signals.effectivePerRound, 25_080)
    assert.equal(report.signals.expectedTotalTokens, 250_800)
    assert.equal(report.signals.inputPricePerM, 0.28)
    assert.ok(report.signals.effectivePerRoundUsd !== null && Math.abs(report.signals.effectivePerRoundUsd - 0.0070224) < 1e-9)
    assert.ok(report.signals.expectedTotalUsd !== null && Math.abs(report.signals.expectedTotalUsd - 0.070224) < 1e-9)
    assert.ok(report.probes.some(p => p.includes('缓存命中率 90%')))
    const text = buildCommandText(report, { minimal: false })
    assert.ok(text.includes('- 缓存命中率 90%'))
    assert.ok(text.includes('计费预期：约 $0.01/轮'), `got: ${text}`)
    assert.ok(text.includes('剩余轮数输入费用预期 ≈ $0.07（约 251K token 计费当量）'))
  })
}
