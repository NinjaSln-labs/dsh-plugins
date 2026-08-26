/**
 * Smoke domain: R1 — 占用趋势 sparkline（ROADMAP 0.9.0，stateVersion 10）。
 * Checks moved verbatim from the monolith (L1623-1659) + AUDIT-driven cases
 * (R1-1 dedup, R1-2 null% advice, R1-3 capture-failure ratio invalidation).
 * Note: in the original file this block runs BETWEEN S2 and S3, so the runner
 * sequences s2 → r1 → s3.
 */
import assert from 'node:assert/strict'
import { sessionHealthProjectionDefinition, applyHealthEvent, healthView } from '../../lib/projection.js'
import { check, config, assertWireSafe } from './helpers.mjs'

const msg = (turn, step, usage) => ({ type: 'assistant/message', data: { turn, step, usage } })
const chunk = (turn, step, usage) => ({ type: 'assistant/chunk', data: { turn, step, chunk: { type: 'usage', usage } } })

export async function run() {
  await check('R1: pressureHistory 随 usage 报告追加（旧→新），缺 inputTokens 的报告不追加', () => {
    let s = sessionHealthProjectionDefinition(config).init()
    s = applyHealthEvent(s, msg(1, 1, { inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }))
    s = applyHealthEvent(s, { type: 'user/message', data: {} }) // 非采样事件
    s = applyHealthEvent(s, msg(2, 1, {})) // 缺 usage → 不追加
    s = applyHealthEvent(s, msg(2, 1, { inputTokens: 300, cacheReadTokens: 50, cacheWriteTokens: 0 }))
    s = applyHealthEvent(s, chunk(3, 1, { inputTokens: 600, cacheReadTokens: 0, cacheWriteTokens: 0 }))
    assert.deepEqual(s.pressureHistory, [100, 350, 600])
    // compaction/end 不采样（压缩前压力快照走 preCompactionPressure，不进趋势）。
    s = applyHealthEvent(s, { type: 'compaction/end' })
    assert.deepEqual(s.pressureHistory, [100, 350, 600])
    const view = healthView(s, config)
    assert.deepEqual(view.pressureHistory, [100, 350, 600])
  })

  await check('R1: 同 (turn, step) 双事件去重——chunk 早样本被 message 终样本替换（AUDIT R1-1）', () => {
    // 流式一次请求：chunk(usage) 先到，随后同 step 的 message 携带最终 usage。
    let s = sessionHealthProjectionDefinition(config).init()
    s = applyHealthEvent(s, chunk(5, 2, { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 }))
    s = applyHealthEvent(s, chunk(5, 2, { inputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0 })) // 同 step 流式增量
    s = applyHealthEvent(s, msg(5, 2, { inputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0 })) // 终样本
    assert.deepEqual(s.pressureHistory, [2000], '同一请求只留一个样本（替换而非双写）')
    assert.deepEqual(s.lastSample, { turn: 5, step: 2 })
    // 下一请求（新 step）正常追加。
    s = applyHealthEvent(s, msg(5, 3, { inputTokens: 5000, cacheReadTokens: 0, cacheWriteTokens: 0 }))
    assert.deepEqual(s.pressureHistory, [2000, 5000])
  })

  await check('R1: 缺 turn/step 的合成事件不参与去重（各自追加，永不塌缩）', () => {
    let s = sessionHealthProjectionDefinition(config).init()
    s = applyHealthEvent(s, { type: 'assistant/message', data: { usage: { inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 } } })
    s = applyHealthEvent(s, { type: 'assistant/message', data: { usage: { inputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 } } })
    assert.deepEqual(s.pressureHistory, [100, 200])
  })

  await check('R1: 采样环形封顶——超过 40 个只留最近 40 个（旧端淘汰）', () => {
    let s = sessionHealthProjectionDefinition(config).init()
    for (let i = 1; i <= 45; i++) {
      s = applyHealthEvent(s, msg(i, 1, { inputTokens: i * 1000, cacheReadTokens: 0, cacheWriteTokens: 0 }))
    }
    assert.equal(s.pressureHistory.length, 40)
    assert.equal(s.pressureHistory[0], 6000) // 前 5 个被淘汰（45-40+1）
    assert.equal(s.pressureHistory[39], 45000)
  })

  await check('R1: 退化 state 的 history 在 view 边界过滤（非有限/负数丢弃，序保持）', () => {
    const view = healthView({ turns: 1, userMessages: 0, assistantMessages: 0, compactions: 0, pressureHistory: [100, NaN, -5, Infinity, 300, 'x', null] }, config)
    assert.deepEqual(view.pressureHistory, [100, 300])
    assertWireSafe(view, 'r1-degenerate')
    // 无 history 字段（v8 旧 state）→ 空数组（strict schema 必须有该键）。
    assert.deepEqual(healthView({ turns: 1, userMessages: 0, assistantMessages: 0, compactions: 0 }, config).pressureHistory, [])
  })

  await check('R1: stateVersion 已 bump 至 10（AUDIT R1-1 折叠语义变化；旧行丢弃全量重放）', () => {
    const def = sessionHealthProjectionDefinition(config)
    assert.equal(def.stateVersion, 10)
  })

  await check('R1: proxyHit 晋级 blue 且 ratio 为 null 时 advice 不含字面量 null%（AUDIT R1-2）', () => {
    const view = healthView(
      { turns: 1, userMessages: 600, assistantMessages: 400, compactions: 0 }, // 1000 条 → proxyHit；无 pressure/window → ratio null
      config,
    )
    assert.equal(view.severity, 'blue')
    assert.ok(view.advice.includes('消息量已达 1000 条'), view.advice)
    assert.ok(!view.advice.includes('null%'), `advice must not leak literal null%: ${view.advice}`)
    assert.ok(!view.advice.includes('NaN'), view.advice)
  })

  await check('R1: 重放重建 history 与在线折叠一致（AUDIT 测试洞 3——harness restore 语义）', () => {
    // harness 丢弃 ver 不匹配行后从 seq 0 全量重放（restore）——纯 fold 重放
    // 两次必须产出完全相同的 state（含 history/lastSample），否则持久化缓存
    // 重建与在线折叠会分叉。
    const events = [
      msg(1, 1, { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 }),
      chunk(1, 2, { inputTokens: 1200, cacheReadTokens: 0, cacheWriteTokens: 0 }),
      msg(1, 2, { inputTokens: 1300, cacheReadTokens: 0, cacheWriteTokens: 0 }), // 同 step 替换
      { type: 'compaction/end' },
      chunk(2, 1, { inputTokens: 600, cacheReadTokens: 0, cacheWriteTokens: 0 }),
      msg(2, 2, { inputTokens: 900, cacheReadTokens: 0, cacheWriteTokens: 0 }),
      msg(3, 1, { inputTokens: 700, cacheReadTokens: 50, cacheWriteTokens: 0 }),
    ]
    const def = sessionHealthProjectionDefinition(config)
    const fold = () => {
      let s = def.init()
      for (const e of events) s = applyHealthEvent(s, e)
      return s
    }
    assert.deepEqual(fold(), fold())
  })

  await check('R1: chunk 路径环形封顶同样生效（AUDIT 测试洞 4）', () => {
    let s = sessionHealthProjectionDefinition(config).init()
    for (let i = 1; i <= 45; i++) {
      s = applyHealthEvent(s, chunk(i, 1, { inputTokens: i * 1000, cacheReadTokens: 0, cacheWriteTokens: 0 }))
    }
    assert.equal(s.pressureHistory.length, 40)
    assert.equal(s.pressureHistory[0], 6000)
    assert.equal(s.pressureHistory[39], 45000)
  })

  await check('R1: compaction 后首个 chunk 采样触发 foldCompression（AUDIT 测试洞 5）', () => {
    // chunk 先建立压力 → compaction 捕获 pre → 下一个 chunk 是 post → 比例推断。
    let s = sessionHealthProjectionDefinition(config).init()
    s = applyHealthEvent(s, chunk(1, 1, { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 }))
    s = applyHealthEvent(s, { type: 'compaction/end' }) // pre = 1000
    s = applyHealthEvent(s, chunk(1, 2, { inputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 })) // post = 400
    const view = healthView(s, config)
    assert.equal(view.compressionRatio, 0.6)
    assert.deepEqual(s.pressureHistory, [1000, 400])
  })

  await check('R1: 压缩捕获失败时陈旧 compressionRatio 失效（AUDIT R1-3）', () => {
    // 先有旧比例：一轮可判定的压缩。
    let s = sessionHealthProjectionDefinition(config).init()
    s = applyHealthEvent(s, msg(1, 1, { inputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 }))
    s = applyHealthEvent(s, { type: 'compaction/end' }) // pre=1000 捕获
    s = applyHealthEvent(s, msg(1, 2, { inputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 })) // post=400 < 1000 → 比例 0.6
    assert.equal(healthView(s, config).compressionRatio, 0.6)
    // 压力清零（零 usage 样本）→ 第二次压缩无法捕获 pre → 陈旧比例必须失效。
    s = applyHealthEvent(s, msg(2, 1, { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }))
    s = applyHealthEvent(s, { type: 'compaction/end' })
    assert.equal(healthView(s, config).compressionRatio, null, 'capture-failed compaction must not show a stale ratio')
    assert.equal(s.compactions, 2)
  })
}
