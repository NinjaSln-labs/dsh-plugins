/**
 * Smoke domain: S2 — stateVersion 向后兼容（ROADMAP 0.8.0）。
 * Checks moved verbatim from the monolith (L1539-1619). The shared
 * assertWireSafe() helper lives in helpers.mjs (R1 reuses it).
 */
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { sessionHealthProjectionDefinition, applyHealthEvent, healthView } from '../../lib/projection.js'
import { check, config, assertWireSafe } from './helpers.mjs'

export async function run() {
  // 语义基线：harness 持久化行带 ver，ver !== stateVersion 的行被丢弃并从
  // init 全量重放（dsh-session-projection 的 viewCheckpoint / restoreFloor）。
  // 因此兼容面 = 「同版本内旧形状 / 退化 JSON state」：任何 JSON 形状的 state
  // 进入 healthView 都不得抛错、不得产 NaN，且输出必须通过 strict wire schema
  // ——否则冷加载路径的 schema.parse 会因旧 state 崩（真实事故向量）。

  await check('S2: v7 形状旧 state（缺 v8 字段）折进 view 无 crash/NaN 且过 wire schema', () => {
    // v8 之前的 state：没有 preCompactionPressure / compressionRatio /
    // lastUsage（v7 及更早无 per-round money buckets 的形状差异由
    // healthView 的可选读取兜住）。
    const v7 = {
      turns: 3, lastTurn: 3, userMessages: 7, assistantMessages: 9, compactions: 1,
      pressureTokens: 200_000, contextWindow: 1_000_000,
      lastUsage: { inputTokens: 50_000, cacheReadTokens: 500_000, cacheWriteTokens: 0 },
    }
    const view = healthView(v7, config)
    assertWireSafe(view, 'v7')
    assert.equal(view.compressionRatio, null) // v7 无比例字段 → 不展示，绝不造假数
  })

  await check('S2: 退化/异形 state 矩阵全安全（空/null/NaN/负数/越界/非整/多余字段）', () => {
    assertWireSafe(healthView({}, config), 'empty')
    const base = { turns: 1, userMessages: 1, assistantMessages: 1, compactions: 0 }
    const matrix = [
      { turns: null, userMessages: null, assistantMessages: null, compactions: null },
      { turns: NaN, userMessages: NaN, assistantMessages: NaN, compactions: NaN },
      { turns: -5, userMessages: -1, assistantMessages: -1, compactions: -1 },
      { turns: 1.9, userMessages: 2.5, assistantMessages: 0.1, compactions: 0.9 },
      { pressureTokens: NaN, contextWindow: NaN },
      { pressureTokens: -100, contextWindow: -1 },
      { pressureTokens: 0, contextWindow: 0 },
      { compressionRatio: NaN }, { compressionRatio: 1.5 }, { compressionRatio: -0.1 },
      { lastUsage: { inputTokens: NaN, cacheReadTokens: null, cacheWriteTokens: undefined } },
      { lastUsage: { inputTokens: -50_000, cacheReadTokens: 0, cacheWriteTokens: 0 } },
      { unknownFutureField: { nested: true } }, // 未来字段透传不得炸 strict schema
    ]
    for (const [i, s] of matrix.entries()) {
      assertWireSafe(healthView({ ...base, ...s }, config), `matrix[${i}]`)
    }
  })

  await check('S2: 旧 state 继续折叠全事件类型 → view 仍全安全', () => {
    const legacy = { turns: 2, lastTurn: 1, userMessages: 3, assistantMessages: 2, compactions: 1 }
    const events = [
      { type: 'step/end', data: { turn: 2 } },
      { type: 'user/message', data: {} },
      { type: 'assistant/message', data: {} },
      { type: 'assistant/message', data: { usage: { inputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
      { type: 'assistant/chunk', data: { chunk: { type: 'usage', usage: { inputTokens: 90_000, cacheReadTokens: 5_000 } } } },
      { type: 'request/context', data: { contextWindow: 1_000_000 } },
      { type: 'compaction/end' },
      { type: 'unknown/future-event', data: {} },
    ]
    let s = legacy
    for (const e of events) s = applyHealthEvent(s, e)
    assertWireSafe(healthView(s, config), 'folded-legacy')
  })

  await check('S2: 真实 harness registry——ver 不匹配的持久化行被丢弃，匹配行出 view 即 schema 合法', () => {
    // 双契约（见 src/projection.ts）：0.1.1+ register 把 wire 归一化为读侧并
    // 擦除顶层 view；rc.6 直接读顶层 def.view。本测试跑在仓库 peer 基线包
    // （rc.6）上，依赖 def 同时携带 view + wire——两代 harness 各取所需。
    const sctx = new Context()
    const registry = new SessionProjectionRegistry(sctx)
    const def = sessionHealthProjectionDefinition(config)
    assert.equal(typeof def.view, 'function', 'dual contract: top-level view (rc.6 read side)')
    assert.equal(typeof def.wire?.view, 'function', 'dual contract: wire.view (0.1.1+ client-visible marker)')
    registry.register(def)
    // 旧版本行（ver = stateVersion - 1）：必须整行丢弃（key 缺席 = 冷消费者
    // 视为「尚未可用」，由全量重放补齐），绝不能把旧形状 state 塞进新 view。
    const stale = registry.viewCheckpoint({ sessionHealth: { ver: def.stateVersion - 1, seq: 9, val: { turns: 3 } } })
    assert.ok(!('sessionHealth' in stale), `stale-ver row must be discarded, got: ${JSON.stringify(stale)}`)
    // 当前版本行：即使 val 是空对象（极端退化），view 也必须 schema 合法。
    const fresh = registry.viewCheckpoint({ sessionHealth: { ver: def.stateVersion, seq: 9, val: {} } })
    assert.ok(fresh.sessionHealth, 'matching row must serve a view')
    assertWireSafe(fresh.sessionHealth, 'checkpoint-view')
  })

  await check('S2: wire payload 键集合稳定（bump stateVersion 前的漂移守卫）', () => {
    const view = healthView({ turns: 1, userMessages: 1, assistantMessages: 1, compactions: 0, pressureTokens: 100_000, contextWindow: 1_000_000 }, config)
    assert.deepEqual(Object.keys(view).sort(), [
      'advice', 'assistantMessages', 'cacheReadTokens', 'compactions', 'compressionRatio',
      'effectivePerRound', 'effectivePerRoundCny', 'effectivePerRoundUsd',
      'pressureHistory', 'pricePeriod',
      'ratio', 'severity', 'total', 'turns', 'uncachedInputTokens', 'userMessages', 'window',
    ])
  })
}
