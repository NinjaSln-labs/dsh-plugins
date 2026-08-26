/**
 * Smoke domain: pricing (official peak/valley document — PriceCache, periodAt,
 * refresh/refreshAny, degradation paths) plus the two pricing-driven behavior
 * checks that immediately follow it in the monolith: `projection: official
 * pricing drives cny/usd money fields` (L774) and `assess: CNY remainingNote`
 * (L791). All moved verbatim; OFFICIAL_DOC lives in helpers.mjs.
 */
import assert from 'node:assert/strict'
import { PriceCache, periodAt, staticPricing } from '../../lib/pricing.js'
import { healthView } from '../../lib/projection.js'
import { assess } from '../../lib/assess.js'
import { buildCommandText } from '../../lib/command.js'
import { check, config, signal, session, services, OFFICIAL_DOC } from './helpers.mjs'

export async function run() {
  await check('pricing: periodAt follows Beijing wall time', () => {
    const hours = [[9, 12], [14, 18]]
    // 2026-08-14T01:00Z = 09:00 Beijing (peak start, inclusive)
    assert.equal(periodAt(hours, Date.parse('2026-08-14T01:00:00Z')), 'peak')
    // 03:59Z = 11:59 Beijing (still peak)
    assert.equal(periodAt(hours, Date.parse('2026-08-14T03:59:00Z')), 'peak')
    // 04:00Z = 12:00 Beijing (peak over)
    assert.equal(periodAt(hours, Date.parse('2026-08-14T04:00:00Z')), 'offpeak')
    // 08:00Z = 16:00 Beijing (afternoon peak)
    assert.equal(periodAt(hours, Date.parse('2026-08-14T08:00:00Z')), 'peak')
    // 10:00Z = 18:00 Beijing (off-peak)
    assert.equal(periodAt(hours, Date.parse('2026-08-14T10:00:00Z')), 'offpeak')
  })

  await check('pricing: auto refresh resolves model + period (peak/offpeak prices)', async () => {
    const cache = new PriceCache(staticPricing(0.28, 0.1))
    const fetchImpl = async () => ({ ok: true, json: async () => structuredClone(OFFICIAL_DOC) })
    assert.equal(await cache.refresh('https://x', fetchImpl), true)
    // Peak window (Beijing 9-12): 2026-08-14T01:00Z
    const origNow = Date.now
    Date.now = () => Date.parse('2026-08-14T01:00:00Z')
    try {
      const p = cache.get('deepseek-v4-flash')
      assert.equal(p.missPerMCny, 3.0)
      assert.equal(p.hitPerMCny, 0.10)
      assert.equal(p.missPerMUsd, 0.44)
      assert.equal(p.hitPerMUsd, 0.014)
      assert.equal(p.period, 'peak')
    } finally { Date.now = origNow }
    // Off-peak: 2026-08-14T10:00Z
    Date.now = () => Date.parse('2026-08-14T10:00:00Z')
    try {
      const p = cache.get('deepseek-v4-flash')
      assert.equal(p.missPerMCny, 1.5)
      assert.equal(p.hitPerMCny, 0.05)
      assert.equal(p.missPerMUsd, 0.22)
      assert.equal(p.period, 'offpeak')
      // unknown model falls back to "*"
      assert.equal(cache.get('some-other-model').missPerMCny, 1.5)
    } finally { Date.now = origNow }
  })

  await check('pricing: failure keeps the last good price', async () => {
    const cache = new PriceCache(staticPricing(0.28, 0.1))
    const ok = async () => ({ ok: true, json: async () => structuredClone(OFFICIAL_DOC) })
    await cache.refresh('https://x', ok)
    const fail = async () => { throw new Error('offline') }
    assert.equal(await cache.refresh('https://x', fail), false)
    // Pin to Beijing off-peak: the get() period is wall-clock dependent, so an
    // assertion on a concrete price must not run during 9-12 / 14-18 CST.
    const origNow = Date.now
    Date.now = () => Date.parse('2026-08-14T10:00:00Z')
    try {
      assert.equal(cache.get().missPerMCny, 1.5) // last good document survives
    } finally { Date.now = origNow }
  })

  await check('pricing: onError callback receives each failed URL (observability)', async () => {
    const cache = new PriceCache(staticPricing(0.28, 0.1))
    const fail = async () => { throw new Error('down') }
    const ok = async () => ({ ok: true, json: async () => structuredClone(OFFICIAL_DOC) })
    const errors = []
    const onError = (url, err) => errors.push({ url, msg: err instanceof Error ? err.message : String(err) })
    // 两个 URL 都失败 → onError 各收到一次。
    assert.equal(await cache.refreshAny(['https://a', 'https://b'], fail, undefined, onError), false)
    assert.deepEqual(errors.map(e => e.url), ['https://a', 'https://b'])
    assert.ok(errors.every(e => e.msg === 'down'))
    // 主失败、回退成功 → onError 只收到主 URL（成功不回调）。
    errors.length = 0
    assert.equal(await cache.refreshAny(['https://a', 'https://b'], url => (url === 'https://a' ? fail() : ok()), undefined, onError), true)
    assert.deepEqual(errors.map(e => e.url), ['https://a'])
    // 默认无 onError → 静默（向后兼容，不抛）。
    assert.equal(await cache.refresh('https://x', fail), false)
  })

  await check('pricing: refreshAny falls back to the second URL', async () => {
    const cache = new PriceCache(staticPricing(0.28, 0.1))
    const fail = async () => { throw new Error('primary down') }
    const ok = async () => ({ ok: true, json: async () => structuredClone(OFFICIAL_DOC) })
    assert.equal(await cache.refreshAny(['https://primary', 'https://fallback'], fail), false) // both down
    assert.equal(cache.get().missPerMCny, null) // static fallback intact
    assert.equal(
      await cache.refreshAny(['https://primary', 'https://fallback'], url => (url.includes('fallback') ? ok() : fail())),
      true,
    )
    // Same off-peak pin as above (peak hours would bill 3.0, not 1.5).
    const origNow = Date.now
    Date.now = () => Date.parse('2026-08-14T10:00:00Z')
    try {
      assert.equal(cache.get('deepseek-v4-flash').missPerMCny, 1.5) // fallback doc won
    } finally { Date.now = origNow }
  })

  await check('pricing: invalid documents are rejected', async () => {
    const cache = new PriceCache(staticPricing(0.28, 0.1))
    for (const bad of [
      { peakHours: [], models: { '*': OFFICIAL_DOC.models['*'] } },
      { peakHours: [[9, 12]], models: {} },
      { peakHours: [[9, 12]], models: { '*': { peak: { inputMissPerMCny: -1, inputHitPerMCny: 0.1, inputMissPerMUsd: 0.44, inputHitPerMUsd: 0.014 }, offpeak: OFFICIAL_DOC.models['*'].offpeak } } },
      { peakHours: [[9, 12]], models: { '*': { peak: { inputMissPerMCny: 1, inputHitPerMCny: 0.1 }, offpeak: OFFICIAL_DOC.models['*'].offpeak } } },
    ]) {
      const fetchImpl = async () => ({ ok: true, json: async () => bad })
      assert.equal(await cache.refresh('https://x', fetchImpl), false, JSON.stringify(bad))
    }
    assert.equal(cache.get().missPerMCny, null) // static fallback intact (USD only)
  })

  await check('pricing: fetch timeout / network abort degrades to static fallback', async () => {
    // refresh() passes AbortSignal.timeout(timeoutMs) to fetch; when the timeout
    // fires the fetch rejects with AbortError. The catch must turn it into
    // `false` (static fallback stays) — never a throw, never a partial doc.
    const cache = new PriceCache(staticPricing(0.28, 0.1))
    const abort = async () => { throw new DOMException('This operation was aborted', 'AbortError') }
    assert.equal(await cache.refresh('https://x', abort, 10_000, () => {}), false)
    assert.equal(cache.get().missPerMCny, null) // never-imported → static fallback (CNY null)
    // A doc that was already good survives a later timeout (last-good-wins).
    const ok = async () => ({ ok: true, json: async () => structuredClone(OFFICIAL_DOC) })
    await cache.refresh('https://x', ok)
    assert.equal(await cache.refresh('https://x', abort, 10_000, () => {}), false)
    const origNow = Date.now
    Date.now = () => Date.parse('2026-08-14T10:00:00Z') // pin Beijing off-peak → 1.5
    try {
      assert.equal(cache.get('deepseek-v4-flash').missPerMCny, 1.5) // last good doc intact
    } finally { Date.now = origNow }
  })

  await check('pricing: oversized content-length rejected (OOM defense)', async () => {
    const cache = new PriceCache(staticPricing(0.28, 0.1))
    // Content-Length > MAX_DOC_BYTES → rejected before parsing, static stays.
    const huge = async () => ({
      ok: true,
      headers: { get: () => String(5 * 1024 * 1024) }, // 5MB > 1MB cap
      json: async () => structuredClone(OFFICIAL_DOC), // would-be-valid doc, unreachable
    })
    const seen = []
    assert.equal(await cache.refresh('https://x', huge, 10_000, (u, e) => seen.push(String(e.message))), false)
    assert.deepEqual(seen, ['pricing document too large'])
    assert.equal(cache.get().missPerMCny, null) // static fallback intact
    // Missing content-length header (or non-finite value) → parsed normally.
    const noLen = async () => ({ ok: true, headers: { get: () => null }, json: async () => structuredClone(OFFICIAL_DOC) })
    assert.equal(await cache.refresh('https://x', noLen, 10_000), true)
  })

  await check('projection: official pricing drives cny/usd money fields', () => {
    const state3 = {
      turns: 1, lastTurn: 1, userMessages: 1, assistantMessages: 1, compactions: 0,
      pressureTokens: 550_000, contextWindow: 1_000_000,
      lastUsage: { inputTokens: 50_000, cacheReadTokens: 500_000, cacheWriteTokens: 0 },
    }
    // off-peak v4-flash: CNY miss 1.5 / hit 0.05, USD miss 0.22 / hit 0.007
    // → discount 0.007/0.22 = 1/31.4; billable = 50K + 500K × (0.007/0.22)
    const price = { missPerMUsd: 0.22, hitPerMUsd: 0.007, missPerMCny: 1.5, hitPerMCny: 0.05, period: 'offpeak' }
    const v = healthView(state3, config, price)
    const billable = 50_000 + 500_000 * (0.007 / 0.22)
    assert.ok(Math.abs(v.effectivePerRound - billable) < 1e-6)
    assert.ok(Math.abs(v.effectivePerRoundCny - (billable * 1.5) / 1e6) < 1e-9) // ¥0.10/轮
    assert.ok(Math.abs(v.effectivePerRoundUsd - (billable * 0.22) / 1e6) < 1e-9) // $0.015/轮
    assert.equal(v.pricePeriod, 'offpeak')
  })

  await check('assess: CNY remainingNote — official pricing + remainingRounds ≥ floor', async () => {
    // V9-4 修复：当 CNY 定价激活且 remainingRounds 足够大时，remainingNote
    // 走 expectedTotalCny && expectedTotalUsd 分支配方定价金额，不再用 ?? 0 兜底。
    // assess 从 projection snapshot 读 effectivePerRoundCny——直接塞 stub snapshot。
    const cnyCtx = {
      get: name => {
        if (name === 'sessionProjections') {
          return {
            snapshot: () => ({
              values: {
                sessionHealth: {
                  severity: 'yellow', advice: 'a', ratio: 0.13, total: 132_000, window: 1_000_000,
                  turns: 2, userMessages: 2, assistantMessages: 1, compactions: 0,
                  uncachedInputTokens: 13_200, cacheReadTokens: 118_800,
                  effectivePerRound: 25_080,
                  effectivePerRoundUsd: 0.007,
                  effectivePerRoundCny: 0.05, // CNY pricing active
                  pricePeriod: 'offpeak',
                },
                tokenUsage: { uncachedInputTokens: 13_200, cacheReadTokens: 118_800, cacheWriteTokens: 0 },
              },
            }),
          }
        }
        return services[name]
      },
    }
    const report = await assess(cnyCtx, session, 'agent-1', signal, config, { remainingRounds: 10 })
    assert.ok(report.signals.expectedTotalCny !== null, 'CNY expected total must be non-null')
    assert.ok(report.signals.expectedTotalUsd !== null, 'USD expected total must be non-null')
    const text = buildCommandText(report, { minimal: false })
    // remainingNote：CNY + USD 同时非 null → 走 ¥xxx（≈$xxx）双币展示
    assert.ok(text.includes('¥'), `CNY remainingNote must show ¥: ${text}`)
    assert.ok(text.includes('$'), `CNY remainingNote must show $: ${text}`)
    assert.ok(!text.includes('$0.00'), `CNY remainingNote must not show $0.00 fallback: ${text}`)
  })
}
