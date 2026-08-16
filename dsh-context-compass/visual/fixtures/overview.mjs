/**
 * dsh-context-compass — visual-regression fixtures.
 *
 * Deterministic `/context-compass-rpc` payloads for the overview panel
 * matrix. The panel reads the RPC route only, so intercepting it with fixed
 * rows makes every panel pixel reproducible (the live projection data varies
 * every request and is deliberately NOT part of the screenshot baselines).
 */

/** One deterministic SessionHealthProjection (full wire shape incl. v8 fields). */
export function healthOf(severity, extra = {}) {
  return {
    severity,
    advice: 'a',
    ratio: null,
    total: null,
    window: 1_000_000,
    turns: 0,
    userMessages: 0,
    assistantMessages: 0,
    compactions: 0,
    compressionRatio: null,
    uncachedInputTokens: null,
    cacheReadTokens: null,
    effectivePerRound: null,
    effectivePerRoundUsd: null,
    effectivePerRoundCny: null,
    pricePeriod: null,
    ...extra,
  }
}

function row(id, title, createdAt, live, health, workspace) {
  return {
    id,
    title,
    live,
    createdAt,
    health,
    workspace: workspace === null ? null : { id: workspace, title: workspace },
  }
}

/**
 * Five rows covering all four severity tiers + unknown — one full page
 * (PAGE_SIZE = 5): the 明/暗 × 四档 matrix baseline.
 */
export const FIVE_TIER_ROWS = [
  row('s-red', '重构合并会话', 100, true,
    healthOf('red', {
      ratio: 0.9, total: 900_000, turns: 41, userMessages: 420, assistantMessages: 419,
      compactions: 2, compressionRatio: 0.4,
      uncachedInputTokens: 300_000, cacheReadTokens: 600_000,
      effectivePerRound: 360_000, effectivePerRoundUsd: 0.1008, effectivePerRoundCny: null, pricePeriod: 'offpeak',
    }), 'dsh-ecosystem'),
  row('s-yellow', '知识库接入调研', 300, false,
    healthOf('yellow', {
      ratio: 0.6, total: 600_000, turns: 22, userMessages: 210, assistantMessages: 209,
      compactions: 1, compressionRatio: 0.3,
      uncachedInputTokens: 60_000, cacheReadTokens: 540_000,
      effectivePerRound: 114_000, effectivePerRoundUsd: 0.0319, effectivePerRoundCny: null, pricePeriod: 'peak',
    }), 'dsh-plugins'),
  row('s-blue', '插件文档整理', 200, false,
    healthOf('blue', {
      ratio: 0.35, total: 350_000, turns: 9, userMessages: 80, assistantMessages: 79,
      compactions: 0,
      uncachedInputTokens: 50_000, cacheReadTokens: 300_000,
      effectivePerRound: 80_000, effectivePerRoundUsd: 0.0224, effectivePerRoundCny: null, pricePeriod: null,
    }), 'research'),
  row('s-green', '双语文档更新', 400, false,
    healthOf('green', {
      ratio: 0.1, total: 100_000, turns: 4, userMessages: 30, assistantMessages: 29,
      compactions: 0,
      uncachedInputTokens: 10_000, cacheReadTokens: 90_000,
      effectivePerRound: 19_000, effectivePerRoundUsd: 0.0053, effectivePerRoundCny: null, pricePeriod: null,
    }), 'dsh-plugins'),
  row('s-unknown', '冷启动会话', 500, false, null, 'other'),
]

/** Six rows (one extra) so the pager shows two pages. */
export const SIX_ROW_PAYLOAD = [
  ...FIVE_TIER_ROWS,
  row('s-green2', '归档会话', 600, false,
    healthOf('green', {
      ratio: 0.05, total: 50_000, turns: 2, userMessages: 10, assistantMessages: 9,
      compactions: 0,
      uncachedInputTokens: 5_000, cacheReadTokens: 45_000,
      effectivePerRound: 9_500, effectivePerRoundUsd: 0.0027, effectivePerRoundCny: null, pricePeriod: null,
    }), 'archive'),
]

export function rpcPayload(rows) {
  return { ok: true, result: { sessions: rows } }
}
