/**
 * Smoke domain: projection (fold counts / severity tiers / economy / proxy /
 * display pct / per-round cost math).
 *
 * Checks moved verbatim from the monolith's projection block. The monolith
 * sandwiched the standalone `usage: cacheHitRateOf` check between this
 * domain's "display pct" and "per-round cost math" checks — to keep the global
 * execution order identical, `runCostMath()` is exported separately and the
 * runner sequences it AFTER usage.run().
 */
import assert from 'node:assert/strict'
import { applyHealthEvent, healthView, compactIntervalRounds } from '../../lib/projection.js'
import { check, config, ratioConfig, state } from './helpers.mjs'

export async function run() {
  await check('projection: fold counts (turns/messages/compactions)', () => {
    assert.equal(state.turns, 2)
    assert.equal(state.userMessages, 2)
    assert.equal(state.assistantMessages, 2)
    assert.equal(state.compactions, 1)
    assert.equal(state.pressureTokens, 32_000) // last usage sample wins
    assert.equal(state.contextWindow, 100_000)
  })

  await check('projection: compactIntervalRounds — turns/compactions 取整', () => {
    assert.equal(compactIntervalRounds(2, 1), 2)
    assert.equal(compactIntervalRounds(10, 3), 3) // 3.33 → 3
    assert.equal(compactIntervalRounds(9, 3), 3)
  })

  await check('projection: compactIntervalRounds — 防御降级返回 null', () => {
    assert.equal(compactIntervalRounds(0, 0), null) // 无压缩
    assert.equal(compactIntervalRounds(5, 0), null) // compactions 0
    assert.equal(compactIntervalRounds(0, 2), null) // turns 0
    assert.equal(compactIntervalRounds(Number.NaN, 2), null) // turns 非有限
    assert.equal(compactIntervalRounds(Infinity, 2), null)
    assert.equal(compactIntervalRounds(2, Number.NaN), null)
  })

  await check('projection: compactIntervalRounds — 商 < 1 取 1（压缩频繁）', () => {
    assert.equal(compactIntervalRounds(1, 3), 1)
    assert.equal(compactIntervalRounds(2, 5), 1)
  })

  await check('projection: 压缩频率补进 view advice（约每 X 轮一次）', () => {
    const v = healthView(state, ratioConfig)
    // fold 后 turns=2, compactions=1 → 约每 2 轮一次，且不破坏原有「已压缩 N 次」。
    assert.ok(v.advice.includes('已压缩 1 次'), `got: ${v.advice}`)
    assert.ok(v.advice.includes('约每 2 轮一次'), `got: ${v.advice}`)
  })

  await check('projection: 无压缩时不补频率文案', () => {
    const st = { turns: 5, lastTurn: 1, userMessages: 3, assistantMessages: 2, compactions: 0, pressureTokens: 30_000, contextWindow: 100_000 }
    const v = healthView(st, ratioConfig)
    assert.ok(!v.advice.includes('约每'), `got: ${v.advice}`)
    assert.ok(!v.advice.includes('已压缩'), `got: ${v.advice}`)
  })

  await check('projection: usage report without inputTokens is skipped (no NaN/0 pollution)', () => {
    const base = { turns: 0, lastTurn: null, userMessages: 0, assistantMessages: 0, compactions: 0, pressureTokens: 360_000 }
    // Streaming chunk usage often omits inputTokens — must NOT overwrite the
    // last good pressure with NaN or 0.
    const chunk = applyHealthEvent(base, { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { outputTokens: 100 } } } })
    assert.equal(chunk.pressureTokens, 360_000)
    assert.equal(chunk.lastUsage, undefined)
    assert.ok(!Number.isNaN(chunk.pressureTokens))
    // Same for assistant/message with an incomplete usage report.
    const msg = applyHealthEvent(base, { type: 'assistant/message', data: { turn: 1, step: 1, usage: { outputTokens: 50 } } })
    assert.equal(msg.pressureTokens, 360_000)
    assert.equal(msg.assistantMessages, 1) // message still counts; usage skipped
    // Complete usage still updates.
    const ok = applyHealthEvent(base, { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 32_000, cacheReadTokens: 0 } } } })
    assert.equal(ok.pressureTokens, 32_000)
    assert.deepEqual(ok.lastUsage, { inputTokens: 32_000, cacheReadTokens: 0, cacheWriteTokens: 0 })
  })

  await check('projection: compression ratio inferred from pressure snapshots', () => {
    // Pre-compaction pressure was 360K (60K uncached + 300K cacheRead on the
    // first assistant/message); the compaction/end captured it; the first
    // usage sample after the fold (32K) yields 1 − 32/360 ≈ 0.911.
    assert.equal(state.preCompactionPressure, undefined) // consumed by the fold
    assert.ok(state.compressionRatio !== null && Math.abs(state.compressionRatio - (1 - 32_000 / 360_000)) < 1e-9)
    // The view carries the ratio + the snapshot-delta caliber note.
    const view = healthView(state, ratioConfig)
    assert.equal(view.compressionRatio, state.compressionRatio)
    assert.ok(view.advice.includes('上次压缩比例'))
    assert.ok(view.advice.includes('快照口径'))
  })

  await check('projection: inconclusive fold (no pressure drop) reads null', () => {
    const base = { turns: 0, lastTurn: null, userMessages: 0, assistantMessages: 0, compactions: 0 }
    let s = applyHealthEvent({ ...base, pressureTokens: 50_000 }, { type: 'compaction/end', data: {} })
    s = applyHealthEvent(s, { type: 'assistant/message', data: { turn: 1, step: 1, usage: { inputTokens: 60_000, cacheReadTokens: 0 } } })
    assert.equal(s.compressionRatio, null) // post >= pre: inconclusive, never a fake 0
    assert.equal(s.preCompactionPressure, undefined)
    assert.equal(healthView(s, ratioConfig).compressionRatio, null)
    // No compaction at all → no inference.
    const plain = healthView({ ...base, pressureTokens: 10_000 }, ratioConfig)
    assert.equal(plain.compressionRatio, null)
  })

  await check('projection: fold keeps last-wins buckets only (rate lives in usage.ts)', () => {
    // The fold no longer accumulates usage totals — the cache-hit rate is read
    // from the core tokenUsage projection via cacheHitRateOf (one algorithm).
    assert.equal(state.usageTotals, undefined)
    assert.equal(state.usageWindow, undefined)
    // Last-request buckets still feed the per-round money math.
    assert.deepEqual(state.lastUsage, { inputTokens: 32_000, cacheReadTokens: 0, cacheWriteTokens: 0 })
  })

  await check('projection: blue severity at 32% occupancy', () => {
    const view = healthView(state, ratioConfig)
    assert.equal(view.severity, 'blue')
    assert.equal(view.ratio, 0.32)
    assert.ok(view.advice.includes('32%'))
  })

  await check('projection: severity tiers across thresholds', () => {
    const base = { turns: 0, lastTurn: null, userMessages: 0, assistantMessages: 0, compactions: 0 }
    const viewOf = (pressure, window) => healthView(
      { ...base, ...(pressure !== null ? { pressureTokens: pressure } : {}), ...(window !== null ? { contextWindow: window } : {}) },
      ratioConfig, // economy floor raised: pure ratio tiers
    )
    assert.equal(viewOf(100_000, 1_000_000).severity, 'green')   // 10%
    assert.equal(viewOf(350_000, 1_000_000).severity, 'blue')    // 35%
    assert.equal(viewOf(600_000, 1_000_000).severity, 'yellow')  // 60%
    assert.equal(viewOf(900_000, 1_000_000).severity, 'red')     // 90%
  })

  await check('projection: economy bills cache-discounted effective per round', () => {
    const base = { turns: 0, lastTurn: null, userMessages: 0, assistantMessages: 0, compactions: 0 }
    const viewOf = (pressure, window, lastUsage) => healthView(
      {
        ...base,
        ...(pressure !== null ? { pressureTokens: pressure } : {}),
        ...(window !== null ? { contextWindow: window } : {}),
        ...(lastUsage !== undefined ? { lastUsage } : {}),
      },
      config,
    )
    // No window: the absolute floor (50K) applies to the billable-equivalent.
    assert.equal(viewOf(60_000, null, { inputTokens: 60_000, cacheReadTokens: 0, cacheWriteTokens: 0 }).severity, 'yellow')
    assert.equal(viewOf(10_000, null, { inputTokens: 10_000, cacheReadTokens: 0, cacheWriteTokens: 0 }).severity, 'green')
  })

  await check('projection: economy floor scales with the window (no 15%-yellow)', () => {
    const base = { turns: 0, lastTurn: null, userMessages: 0, assistantMessages: 0, compactions: 0 }
    const viewOf = (pressure, window, lastUsage) => healthView(
      { ...base, ...(pressure !== null ? { pressureTokens: pressure } : {}), ...(window !== null ? { contextWindow: window } : {}), lastUsage },
      config,
    )
    // 1M window → economy floor = max(50K, 0.3 × 1M) = 300K billable-equivalent.
    // The old 50K floor fired at 10% occupancy; now 15% stays green (cached or not).
    assert.equal(
      viewOf(100_000, 1_000_000, { inputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 }).severity,
      'green', // 10% occupancy, billable 100K < 300K
    )
    assert.equal(
      viewOf(150_000, 1_000_000, { inputTokens: 15_000, cacheReadTokens: 135_000, cacheWriteTokens: 0 }).severity,
      'green', // 15% occupancy, 90% cache hit → billable 28.5K < 300K
    )
    // Uncached at 32%: billable 320K ≥ 300K → economy outranks the blue tier.
    const v = viewOf(320_000, 1_000_000, { inputTokens: 320_000, cacheReadTokens: 0, cacheWriteTokens: 0 })
    assert.equal(v.severity, 'yellow')
    assert.ok(v.advice.includes('已计缓存折扣'))
  })

  await check('projection: message-count proxy escalates green → blue (window-scaled)', () => {
    // A4：effectiveProxy = max(800, window × 0.002)。1M 窗口 → 2000。
    const base = {
      turns: 40, lastTurn: null, userMessages: 1200, assistantMessages: 1300,
      compactions: 0, pressureTokens: 20_000, contextWindow: 1_000_000,
    }
    const view = healthView(base, config) // 2% occupancy, 2500 messages ≥ 2000 proxy
    assert.equal(view.severity, 'blue')
    assert.ok(view.advice.includes('代理指标'))
    assert.ok(view.advice.includes('2500'))
    // 1M 窗口 1500 消息 < 2000：不触发（旧 800 阈值下会误触发）。
    const mid = healthView({ ...base, userMessages: 700, assistantMessages: 800 }, config)
    assert.equal(mid.severity, 'green')
    // 128K 窗口：effectiveProxy = max(800, 256) = 800 → 1000 消息仍触发。
    const smallWindow = healthView({ ...base, userMessages: 500, assistantMessages: 500, contextWindow: 128_000 }, config)
    assert.equal(smallWindow.severity, 'blue')
  })

  await check('projection: display pct clamps to 100 for ratio > 1 (caliber gap)', () => {
    // ratio > 1 (pressure exceeding the known window) must display 100%, never
    // a misleading >100% "已占窗口" figure; the real ratio is preserved.
    const base = { turns: 0, lastTurn: null, userMessages: 0, assistantMessages: 0, compactions: 0 }
    const over = healthView({ ...base, pressureTokens: 1_500_000, contextWindow: 1_000_000 }, config) // ratio 1.5
    assert.equal(over.ratio, 1.5) // real ratio preserved for analysis
    assert.ok(over.advice.includes('100%')) // display clamped to 100
    assert.equal(over.severity, 'red')
    // window=0 → no ratio tier at all (division-by-window only when window > 0).
    const zeroW = healthView({ ...base, pressureTokens: 1_000_000, contextWindow: 0 }, config)
    assert.equal(zeroW.ratio, null)
    assert.equal(zeroW.severity, 'green') // no window → can't judge occupancy
    assert.ok(!(zeroW.advice.includes('NaN')))
  })
}

/** Monolith L281-296 — runs after usage.run() to preserve global order. */
export async function runCostMath() {
  await check('projection: per-round cost math (token + USD) — cacheHitRate no longer carried', () => {
    const state2 = {
      turns: 1, lastTurn: 1, userMessages: 1, assistantMessages: 1, compactions: 0,
      pressureTokens: 550_000, contextWindow: 1_000_000,
      lastUsage: { inputTokens: 50_000, cacheReadTokens: 500_000, cacheWriteTokens: 0 },
    }
    const v = healthView(state2, config) // cacheHitDiscount 0.1, inputPricePerM 0.28
    assert.equal(v.cacheHitRate, undefined) // rate lives in src/usage.ts off the core tokenUsage projection
    assert.equal(v.uncachedInputTokens, 50_000)
    assert.equal(v.cacheReadTokens, 500_000)
    assert.equal(v.effectivePerRound, 50_000 + 500_000 * 0.1) // 100K billable-equivalent
    assert.ok(Math.abs(v.effectivePerRoundUsd - (100_000 * 0.28) / 1_000_000) < 1e-9) // $0.028/轮
    const empty = healthView({ ...state2, lastUsage: undefined }, config)
    assert.equal(empty.effectivePerRound, null)
    assert.equal(empty.effectivePerRoundUsd, null)
  })
}
