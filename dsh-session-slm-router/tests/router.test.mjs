/**
 * dsh-session-slm-router 单元测试（Node 内置 test runner，零依赖）。
 *
 * 覆盖 plan-b5-dsh.md S1 要求：
 *   - switch 判定表（spec §4 五行）
 *   - health 标记（slot 匹配 → healthy；未知模型 → unknown）
 *   - would_bind 语义（stay 不算、目标不健康不算）
 *   - tierOf：slot 优先 + 名称启发式
 *   - extractUtterance：content 块 / text / parts / 空值
 *   - predict 超时：timeoutMs 小于 CLI 实际耗时 → ok=false 且不抛异常
 *
 * 运行：npm test（node --test tests/）
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const indexJs = join(here, '..', 'lib', 'index.js')
const { tierOf, extractUtterance, computeDecision, shouldSkipUtterance, decideWeakOnly, currentHealthOf, buildShadowEvent } = await import(
  'file://' + indexJs.replace(/\\/g, '/')
)
const {
  configHashOf, isFreeSlot, orderSlots, mergeProviderValidation,
  isModelUnavailableFailure, isCacheUsable,
} = await import('file://' + join(here, '..', 'lib', 'slot-health.js').replace(/\\/g, '/'))

const CFG = {
  mode: 'shadow',
  predictCmd: 'python3 /mnt/e/ninjasin-labs/vertical-small-model/scripts/route_predict.py',
  predictModel: '/mnt/e/ninjasin-labs/vertical-small-model/data/eval/routing-v0/model-r1.json',
  timeoutMs: 250,
  logPath: 'slm-shadow/test.jsonl',
  weakSlots: [
    { provider: 'opencode-go-custom', model: 'ox-alpha-free' },
    { provider: 'commandcode', model: 'deepseek/deepseek-v4-flash' },
  ],
  strongSlots: [
    { provider: 'commandcode', model: 'deepseek/deepseek-v4-pro' },
  ],
}

// ---------- switch 判定表（spec §4）----------

test('判定表: weak建议 × weak实际 → stay, agree=true', () => {
  const d = computeDecision(CFG, 'weak', 'weak', 'opencode-go-custom', 'ox-alpha-free')
  assert.equal(d.switch, 'stay')
  assert.equal(d.agree, true)
  assert.equal(d.wouldBind, false)
})

test('判定表: strong建议 × strong实际 → stay, agree=true', () => {
  const d = computeDecision(CFG, 'strong', 'strong', 'commandcode', 'deepseek/deepseek-v4-pro')
  assert.equal(d.switch, 'stay')
  assert.equal(d.agree, true)
})

test('判定表: weak建议 × strong实际 → switch_to_weak 指向weakSlot[0]', () => {
  const d = computeDecision(CFG, 'weak', 'strong', 'commandcode', 'deepseek/deepseek-v4-pro')
  assert.equal(d.switch, 'switch_to_weak')
  assert.deepEqual([d.targetProvider, d.targetModel], ['opencode-go-custom', 'ox-alpha-free'])
  assert.equal(d.agree, false)
  assert.equal(d.wouldBind, true) // 目标健康 → 本该省成本
})

test('判定表: strong建议 × weak实际 → switch_to_strong 指向strongSlot[0]', () => {
  const d = computeDecision(CFG, 'strong', 'weak', 'opencode-go-custom', 'ox-alpha-free')
  assert.equal(d.switch, 'switch_to_strong')
  assert.deepEqual([d.targetProvider, d.targetModel], ['commandcode', 'deepseek/deepseek-v4-pro'])
  assert.equal(d.agree, false)
  assert.equal(d.wouldBind, true) // 目标健康 → 本该保质量
})

test('判定表: 实际档unknown → 不换(switch=null), agree=null语义(false)', () => {
  const d = computeDecision(CFG, 'weak', 'unknown', 'some-provider', 'some-model')
  assert.equal(d.switch, null)
  assert.equal(d.agree, false)
  assert.equal(d.currentHealth, 'unknown') // 未知模型 → 健康也未知
  assert.equal(d.wouldBind, false)
})

test('判定表: 预测失败(suggested=null) → 全空, 无动作', () => {
  const d = computeDecision(CFG, null, 'weak', 'opencode-go-custom', 'ox-alpha-free')
  assert.equal(d.switch, null)
  assert.equal(d.targetProvider, null)
  assert.equal(d.agree, false)
  assert.equal(d.wouldBind, false)
})

// ---------- health 标记 ----------

test('health: 已知slot → healthy; 未知模型 → unknown', () => {
  const known = computeDecision(CFG, 'weak', 'weak', 'agnes', 'agnes-2.5-flash')
  // 注意 agnes 不在本测试 CFG 的 slots 中 → unknown
  assert.equal(known.currentHealth, 'unknown')
  const inCfg = computeDecision(CFG, 'weak', 'weak', 'commandcode', 'deepseek/deepseek-v4-flash')
  assert.equal(inCfg.currentHealth, 'healthy')
})

test('health: 有switch动作时 target_health=healthy, 否则null', () => {
  const sw = computeDecision(CFG, 'strong', 'weak', 'opencode-go-custom', 'ox-alpha-free')
  assert.equal(sw.targetHealth, 'healthy')
  const noSw = computeDecision(CFG, 'weak', 'weak', 'commandcode', 'deepseek/deepseek-v4-flash')
  assert.equal(noSw.targetHealth, null)
})

// ---------- tierOf ----------

test('tierOf: slot优先于启发式（名字含pro但在strongSlot→strong）', () => {
  assert.equal(tierOf('commandcode', 'deepseek/deepseek-v4-pro', [], CFG.strongSlots), 'strong')
})

test('tierOf: 启发式 flash/lite/mini/haiku → weak', () => {
  for (const m of ['abc-flash', 'x-lite', 'mini-9', 'haiku-3']) {
    assert.equal(tierOf('p', m, [], []), 'weak', m)
  }
})

test('tierOf: free 不代表弱档——deepseek-v4-pro-free → strong（pro 模型免费版）', () => {
  // free 只表示免费，不是强弱标准；pro 才是强档依据
  assert.equal(tierOf('teamorouter', 'deepseek-v4-pro-free', [], []), 'strong')
})

test('tierOf: free 后缀且无强档特征 → unknown（不做假设）', () => {
  // free 不作为弱档匹配，也不作为强档匹配
  assert.equal(tierOf('p', 'some-model-free', [], []), 'unknown')
  assert.equal(tierOf('p', 'laguna-s-2.1-free', [], []), 'unknown')
})

test('tierOf: 启发式 ox-alpha → weak（轻量模型）', () => {
  for (const m of ['stealth/ox-alpha', 'ox-alpha', 'ox-alpha-v2', 'ox-alpha-free']) {
    assert.equal(tierOf('p', m, [], []), 'weak', m)
  }
})

test('tierOf: 启发式 pro(非flash)/opus/sonnet/gpt-4 → strong', () => {
  for (const m of ['v4-pro', 'opus-4', 'sonnet-3.7', 'gpt-4o']) {
    assert.equal(tierOf('p', m, [], []), 'strong', m)
  }
})

test('tierOf: 启发式 kimi/qwen-coder+plus+max/glm/deepseek-v3+/deepseek-r1/mimo/minimax → strong', () => {
  for (const m of ['kimi-k2.7-code', 'kimi-k3', 'qwen3-coder-plus', 'qwen3.7-max', 'glm-5.2', 'deepseek-v3.2', 'deepseek-r1', 'mimo-v2.5', 'minimax-m2.7-free', 'minimax-m3-free', 'MiniMax-M2.1']) {
    assert.equal(tierOf('p', m, [], []), 'strong', m)
  }
})

test('tierOf: pro-flash 不误判为strong（flash先命中）', () => {
  assert.equal(tierOf('p', 'deepseek-v4-pro-flash', [], []), 'weak')
})

test('tierOf: kimi-flash → weak（flash先命中的边界保护）', () => {
  assert.equal(tierOf('p', 'kimi-k3-flash', [], []), 'weak')
})

test('tierOf: glm-flash → weak（flash先命中，不被glm strong覆盖）', () => {
  assert.equal(tierOf('p', 'glm-5.3-flash', [], []), 'weak')
})

test('tierOf: qwen-flash → weak（flash先命中）', () => {
  assert.equal(tierOf('p', 'qwen3-coder-flash', [], []), 'weak')
})

test('tierOf: 其余 → unknown（无匹配特征）', () => {
  assert.equal(tierOf('p', 'some-random-model', [], []), 'unknown')
  assert.equal(tierOf('p', 'llama-3-70b', [], []), 'unknown')
})

// ---------- extractUtterance ----------

test('utterance: content text块拼接', () => {
  const u = extractUtterance({ content: [{ type: 'text', text: '帮我看下 ' }, { type: 'text', text: 'package.json' }] })
  assert.equal(u, '帮我看下 package.json')
})

test('utterance: 纯text回退 / parts回退', () => {
  assert.equal(extractUtterance({ text: '继续审计' }), '继续审计')
  assert.equal(extractUtterance({ parts: [{ type: 'text', text: '进度如何' }] }), '进度如何')
})

test('utterance: 非文本块/空对象/null → null（跳过本轮影子）', () => {
  assert.equal(extractUtterance({ content: [{ type: 'image', url: 'x.png' }] }), null)
  assert.equal(extractUtterance({}), null)
  assert.equal(extractUtterance(null), null)
  assert.equal(extractUtterance('string-not-object'), null)
})

// ---------- predict 超时（真实 CLI，50ms 必超时）----------

test('predict: timeoutMs=50 < CLI实际耗时(~150ms+) → ok=false, error含kill/timeout语义, 不阻塞', async () => {
  const { predict } = await import('file://' + indexJs.replace(/\\/g, '/'))
  const t0 = Date.now()
  const r = await predict({ ...CFG, timeoutMs: 50 }, '继续审计这个计划的所有问题')
  const wall = Date.now() - t0
  assert.equal(r.ok, false)
  assert.ok(r.error.length > 0, '应有错误信息')
  assert.ok(wall < 500, `应在远小于CLI正常耗时处返回，实际 ${wall}ms`)
})

test('predict: 空utterance直接短路 → ok=false "empty utterance"', async () => {
  const { predict } = await import('file://' + indexJs.replace(/\\/g, '/'))
  const r = await predict(CFG, '   ')
  assert.equal(r.ok, false)
  assert.equal(r.error, 'empty utterance')
})

// ---------- shouldSkipUtterance（三层过滤）----------

test('skip: A类 DSH内部系统消息 → 跳过（大小写不敏感）', () => {
  assert.equal(shouldSkipUtterance('Background subagent 3e4899aa finished'), true)
  assert.equal(shouldSkipUtterance('background subagent abc-123'), true) // 全小写
  assert.equal(shouldSkipUtterance('<goal_round> Objective: "交付"'), true)
  assert.equal(shouldSkipUtterance('subagent-id: xyz'), true)
  assert.equal(shouldSkipUtterance('skill-catalog updated'), true)
})

test('skip: B类 UI表单任务 → 跳过（非用户真实复杂任务）', () => {
  assert.equal(shouldSkipUtterance('Showcase Your Services In A Gig Gallery'), true)
  assert.equal(shouldSkipUtterance('showcase your services in a gig gallery'), true) // 小写
  assert.equal(shouldSkipUtterance('Edit your new profile'), true)
  assert.equal(shouldSkipUtterance('Your service was created'), true)
  assert.equal(shouldSkipUtterance('Tagline can only contain letters'), true)
  assert.equal(shouldSkipUtterance('work experience\nAdd new\nTitle\nCompany name'), true)
})

test('skip: C类 系统错误回显 → 跳过', () => {
  assert.equal(shouldSkipUtterance('400: {"message":"InternalError..."}'), true)
  assert.equal(shouldSkipUtterance('本轮运行失败pi-ai provider'), true)
  assert.equal(shouldSkipUtterance('Request timed out.'), true)
})

test('skip: 正常用户话语 → 不跳过', () => {
  assert.equal(shouldSkipUtterance('继续审计这个计划的所有问题'), false)
  assert.equal(shouldSkipUtterance('能查下具体根因吗？'), false)
  assert.equal(shouldSkipUtterance('查看后台任务状态'), false)
  assert.equal(shouldSkipUtterance('已重启'), false)
  assert.equal(shouldSkipUtterance('好'), false)
})

test('skip: 空字符串 → 不跳过（由上层 if(!utterance) 处理）', () => {
  assert.equal(shouldSkipUtterance(''), false)
  assert.equal(shouldSkipUtterance(null), false)
})

// ---------- weak-only 决策（S2b：只降档） ----------
// candidates = 已按槽位健康缓存排序后的可用候选槽（第一位为换模目标）

const W0 = { provider: 'opencode-go-custom', model: 'ox-alpha-free' }
const W1 = { provider: 'commandcode', model: 'deepseek/deepseek-v4-flash' }

test('weak-only: 候选槽首位可用 → bound=true, target_health=healthy', () => {
  const d = decideWeakOnly(
    CFG, 'weak', 'strong', 'commandcode', 'deepseek/deepseek-v4-pro',
    false, true, [W0, W1],
  )
  assert.equal(d.switch, 'switch_to_weak')
  assert.equal(d.bound, true)
  assert.equal(d.targetHealth, 'healthy')
  assert.deepEqual([d.targetProvider, d.targetModel], ['opencode-go-custom', 'ox-alpha-free'])
})

test('weak-only: 无候选槽 → bound=false, target_health=unhealthy', () => {
  const d = decideWeakOnly(
    CFG, 'weak', 'strong', 'commandcode', 'deepseek/deepseek-v4-pro',
    false, true, [], // 全部槽位不可用
  )
  assert.equal(d.switch, 'switch_to_weak')
  assert.equal(d.bound, false)
  assert.equal(d.targetHealth, 'unhealthy')
})

test('weak-only: 首选槽死 → 用候选第二槽（同档下一备选）', () => {
  // W0 被沉底（不在候选），W1 顶上来
  const d = decideWeakOnly(
    CFG, 'weak', 'strong', 'commandcode', 'deepseek/deepseek-v4-pro',
    false, true, [W1],
  )
  assert.equal(d.switch, 'switch_to_weak')
  assert.deepEqual([d.targetProvider, d.targetModel], ['commandcode', 'deepseek/deepseek-v4-flash'])
  assert.equal(d.bound, true)
})

test('weak-only: switch_to_strong 不放行 → bound=false（B 层过敏，仅记录）', () => {
  const d = decideWeakOnly(
    CFG, 'strong', 'weak', 'opencode-go-custom', 'ox-alpha-free',
    false, true, [W0],
  )
  assert.equal(d.switch, 'switch_to_strong')
  assert.equal(d.bound, false)
})

test('weak-only: abstain → stay, bound=false（C 层弃权回退）', () => {
  const d = decideWeakOnly(
    CFG, 'strong', 'weak', 'opencode-go-custom', 'ox-alpha-free',
    true, true, [W0],
  )
  assert.equal(d.switch, 'stay')
  assert.equal(d.bound, false)
  assert.equal(d.targetProvider, null)
})

test('weak-only: 非主会话（allowBind=false）→ switch_to_weak 但 bound=false', () => {
  const d = decideWeakOnly(
    CFG, 'weak', 'strong', 'commandcode', 'deepseek/deepseek-v4-pro',
    false, false, [W0],
  )
  assert.equal(d.switch, 'switch_to_weak')
  assert.equal(d.bound, false)
})

test('weak-only: stay 建议 → bound=false', () => {
  const d = decideWeakOnly(
    CFG, 'weak', 'weak', 'opencode-go-custom', 'ox-alpha-free',
    false, true, [W0],
  )
  assert.equal(d.switch, 'stay')
  assert.equal(d.bound, false)
})

test('weak-only: 预测失败（suggested=null）→ 全空, bound=false', () => {
  const d = decideWeakOnly(
    CFG, null, 'weak', 'opencode-go-custom', 'ox-alpha-free',
    false, true, [W0],
  )
  assert.equal(d.switch, null)
  assert.equal(d.bound, false)
})

// ---------- 槽位健康缓存（slot-health） ----------

test('slot-health: configHashOf 对同配置稳定、异配置不同', () => {
  assert.equal(configHashOf(CFG.weakSlots), configHashOf(CFG.weakSlots))
  assert.notEqual(configHashOf(CFG.weakSlots), configHashOf([{ provider: 'x', model: 'y' }]))
})

test('slot-health: isFreeSlot 识别 free 标记的 model/provider', () => {
  assert.equal(isFreeSlot({ provider: 'p', model: 'ox-alpha-free' }), true)
  assert.equal(isFreeSlot({ provider: 'commandcode-free', model: 'minimax-m2.7-free' }), true)
  assert.equal(isFreeSlot({ provider: 'p', model: 'agnes-2.5-flash' }), false)
})

test('slot-health: orderSlots —— ok free 优先、dead 沉底、同档保配置序', () => {
  const config = [W0, W1, { provider: 'agnes', model: 'agnes-2.5-flash' }] // W0 是 free
  const statuses = new Map([
    ['opencode-go-custom::ox-alpha-free', { status: 'dead', source: 'provider' }], // 死了
    ['commandcode::deepseek/deepseek-v4-flash', { status: 'ok', source: 'provider' }],
    ['agnes::agnes-2.5-flash', { status: 'unknown', source: 'provider' }],
  ])
  const ordered = orderSlots(config, statuses)
  assert.deepEqual(ordered, [W1, { provider: 'agnes', model: 'agnes-2.5-flash' }, W0]) // ok → unknown → dead
})

test('slot-health: orderSlots —— 同为 ok 时 free 槽排非 free 前', () => {
  const config = [{ provider: 'a', model: 'm1' }, { provider: 'b', model: 'm2-free' }, { provider: 'c', model: 'm3' }]
  const statuses = new Map([
    ['a::m1', { status: 'ok', source: 'provider' }],
    ['b::m2-free', { status: 'ok', source: 'provider' }],
    ['c::m3', { status: 'ok', source: 'provider' }],
  ])
  const ordered = orderSlots(config, statuses)
  assert.deepEqual(ordered, [{ provider: 'b', model: 'm2-free' }, { provider: 'a', model: 'm1' }, { provider: 'c', model: 'm3' }])
})

test('slot-health: mergeProviderValidation —— provider 注销→dead(provider)，model 级 dead 保留', () => {
  const config = [W0, W1]
  const prev = new Map([
    ['opencode-go-custom::ox-alpha-free', { status: 'ok', source: 'provider' }],
    ['commandcode::deepseek/deepseek-v4-flash', { status: 'dead', source: 'model' }],
  ])
  // opencode-go-custom 注销；commandcode 仍在
  const next = mergeProviderValidation(config, ['commandcode'], prev)
  assert.equal(next.get('opencode-go-custom::ox-alpha-free').status, 'dead')
  assert.equal(next.get('opencode-go-custom::ox-alpha-free').source, 'provider')
  assert.equal(next.get('commandcode::deepseek/deepseek-v4-flash').status, 'dead') // model 级保留
  assert.equal(next.get('commandcode::deepseek/deepseek-v4-flash').source, 'model')
})

test('slot-health: isModelUnavailableFailure 只认确定性模型不可用', () => {
  assert.equal(isModelUnavailableFailure({ code: 'NO_ADAPTER', status: 0, message: 'no adapter for provider' }), true)
  assert.equal(isModelUnavailableFailure({ code: 'MODEL_NOT_FOUND', status: 0, message: 'x' }), true)
  assert.equal(isModelUnavailableFailure({ code: 'x', status: 404, message: 'y' }), true)
  assert.equal(isModelUnavailableFailure({ code: 'x', status: 0, message: '模型不存在' }), true)
  // 瞬态/限流/5xx 不淘汰
  assert.equal(isModelUnavailableFailure({ code: 'RATE_LIMITED', status: 429, message: 'slow down' }), false)
  assert.equal(isModelUnavailableFailure({ code: 'TIMEOUT', status: 0, message: 'timed out' }), false)
  assert.equal(isModelUnavailableFailure({ code: 'x', status: 500, message: 'internal' }), false)
})

test('slot-health: isCacheUsable —— 版本/hash/TTL 任一不符即不可用', () => {
  const fresh = { v: 1, configHash: 'h', updatedAt: new Date(Date.now() - 1000).toISOString(), slots: [] }
  const expired = { v: 1, configHash: 'h', updatedAt: new Date(Date.now() - 25 * 3600 * 1000).toISOString(), slots: [] }
  const mismatch = { v: 1, configHash: 'other', updatedAt: new Date(Date.now() - 1000).toISOString(), slots: [] }
  assert.equal(isCacheUsable(fresh, 'h'), true)
  assert.equal(isCacheUsable(expired, 'h'), false)
  assert.equal(isCacheUsable(mismatch, 'h'), false)
  assert.equal(isCacheUsable(undefined, 'h'), false)
})

// ---------- currentHealthOf ----------

test('currentHealthOf: 已知 slot → healthy; 未知 → unknown', () => {
  assert.equal(currentHealthOf(CFG, 'opencode-go-custom', 'ox-alpha-free'), 'healthy')
  assert.equal(currentHealthOf(CFG, 'some-provider', 'some-model'), 'unknown')
})

// ---------- buildShadowEvent（bound 字段 + preview 截断 + 隐私） ----------

test('buildShadowEvent: 含 bound 字段 + preview ≤80 字符', () => {
  const d = decideWeakOnly(
    CFG, 'weak', 'strong', 'commandcode', 'deepseek/deepseek-v4-pro',
    false, true, ['opencode-go-custom'],
  )
  const e = buildShadowEvent({
    sessionId: 's1', turnSeq: 1, utterance: 'x'.repeat(100),
    suggestedTier: 'weak', confidence: 0.8, abstained: false,
    actualProvider: 'commandcode', actualModel: 'deepseek/deepseek-v4-pro',
    actualTier: 'strong', decision: d, predictMs: 50, predictOk: true, error: null,
  })
  assert.equal(e.bound, true)
  assert.ok(e.utterance_preview.length <= 80, `preview ${e.utterance_preview.length}`)
  assert.equal(e.utterance_hash.length, 16)
})

test('buildShadowEvent: error 只记简短原因（不含命令/原话）', () => {
  const d = decideWeakOnly(CFG, null, 'weak', 'opencode-go-custom', 'ox-alpha-free', false, true, [])
  const e = buildShadowEvent({
    sessionId: 's1', turnSeq: 2, utterance: '私密原话',
    suggestedTier: null, confidence: null, abstained: null,
    actualProvider: 'opencode-go-custom', actualModel: 'ox-alpha-free',
    actualTier: 'weak', decision: d, predictMs: 0, predictOk: false, error: 'predict failed: timeout',
  })
  assert.equal(e.error, 'predict failed: timeout')
  assert.ok(!e.error.includes('私密原话'))
})
