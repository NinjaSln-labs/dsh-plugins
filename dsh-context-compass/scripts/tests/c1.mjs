/**
 * Smoke domain: C1 — settings 配置点（docs/C1-SETTINGS-DESIGN.md）。
 * Checks moved verbatim from the monolith (L1784-1815).
 */
import assert from 'node:assert/strict'
import { resolveConfig, validateThresholdLadder, validateConfig, readConfig } from '../../lib/config.js'
import { sessionHealthTool } from '../../lib/tool.js'
import { check, config, signal, session, ctx } from './helpers.mjs'

export async function run() {
  await check('C1: validateThresholdLadder——三档单调通过，非单调拒绝', () => {
    validateThresholdLadder(resolveConfig({})) // 默认 0.3/0.5/0.8：通过
    assert.throws(
      () => validateThresholdLadder(resolveConfig({ thresholds: { windowMid: 0.5, windowHigh: 0.5, windowCritical: 0.8 } })),
      /单调递增/,
    )
    assert.throws(
      () => validateThresholdLadder(resolveConfig({ thresholds: { windowMid: 0.1, windowHigh: 0.9, windowCritical: 0.5 } })),
      /单调递增/,
    )
  })

  await check('C1: validateConfig 拒绝 NaN/Infinity 数值字段（AUDIT C1-3）', () => {
    validateConfig(resolveConfig({})) // 默认全有限：通过
    // YAML 外部编辑可注入 .nan/.inf（绕过 settings 写路径的 JSON 形状检查）；
    // schemastery 范围校验对 NaN 恒 false——validateConfig 必须显式拦截。
    assert.throws(
      () => validateConfig(resolveConfig({ thresholds: { economyTokenFloor: Number.NaN } })),
      /非负有限/,
    )
    assert.throws(
      () => validateConfig(resolveConfig({ cost: { inputPricePerM: Number.POSITIVE_INFINITY } })),
      /非负有限/,
    )
    // window 三元组的 NaN 由 ladder 校验先拦截（NaN 破坏单调）——此处只验
    // ladder 保护不到的数值字段。
    // 负数同样拒绝（schema min(0) 拦得住数字但 validateConfig 双保险）。
    assert.throws(
      () => validateConfig(resolveConfig({ cost: { priceRefreshHours: -1 } })),
      /非负有限/,
    )
  })

  await check('C1: readConfig——快照与 thunk 两种形态都读到值', () => {
    assert.equal(readConfig(config), config)
    let inner = config
    const thunk = () => inner
    assert.equal(readConfig(thunk), config)
    inner = resolveConfig({ thresholds: { windowCritical: 0.95 } })
    assert.equal(readConfig(thunk).thresholds.windowCritical, 0.95) // 换内层 → 读到新值
  })

  await check('C1: 工具经 source thunk 读配置——换 thunk 内层，行为即时变化（无需重挂）', async () => {
    let cfg = config
    const liveTool = sessionHealthTool(ctx, () => cfg)
    const run = () => liveTool.execute({ reason: '自检', remainingRounds: 5 }, { agent: { id: 'agent-1', session }, signal })
    const before = await run()
    assert.equal(before.severity, 'yellow') // 基线：经济命中（300K/1M）→ 黄
    // 切内层：经济门槛抬到 400K → 300K 不再命中 → 蓝（A3 升级也随之消失）
    cfg = resolveConfig({ thresholds: { economyTokenFloor: 400_000 } })
    const after = await run()
    assert.equal(after.severity, 'blue')
  })
}
