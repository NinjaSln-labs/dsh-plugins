/**
 * weakSlots 槽位健康缓存（S3 灰度增强）。
 *
 * 目标：配置序 ≠ 生效序。provider 已注销 / 模型实测不可用的槽位沉底，
 * free 槽位优先，结果持久化到缓存文件，重启直接恢复。
 *
 * 三档状态：
 *   ok      —— provider 已注册，可作换模目标
 *   dead    —— 不可用。source=provider（provider 注销，重验可复活）
 *              source=model（实际调用报模型不可用，保留至缓存过期/TTL 重建才复活）
 *   unknown —— 瞬态失败（超时等），原地保留不降级，防误杀
 *
 * 刷新触发：启动、`llm/adapters-updated`（用户改供应商/模型配置）、缓存过期（24h TTL）。
 * 缓存文件删除即重建（无缓存时按配置序 + provider 注册态重验）。
 */

import { createHash } from 'node:crypto'
import type { ModelSlot } from './config.ts'

export type { ModelSlot }

export type SlotStatus = 'ok' | 'dead' | 'unknown'
export type SlotSource = 'provider' | 'model'

export interface SlotHealthEntry {
  provider: string
  model: string
  status: SlotStatus
  source: SlotSource
  /** model 级淘汰的时间戳（ISO）——用于条目级 TTL 复活 */
  demotedAt?: string
}

export interface SlotCacheFile {
  v: 1
  configHash: string
  updatedAt: string
  slots: SlotHealthEntry[]
}

/** 缓存 TTL：24 小时 */
export const SLOT_CACHE_TTL_MS = 24 * 60 * 60 * 1000

export function slotKey(provider: string, model: string): string {
  return `${provider}::${model}`
}

/** weakSlots 配置摘要——变了说明用户改过槽位配置，缓存顺序不可信 */
export function configHashOf(slots: readonly ModelSlot[]): string {
  return createHash('sha256').update(JSON.stringify(slots)).digest('hex').slice(0, 16)
}

/** free 标记的供应商/模型——同为可用时优先（纯成本考虑；注意 free 不代表弱档，此处只作用于 weakSlots 内部排序） */
export function isFreeSlot(slot: ModelSlot): boolean {
  return /free/i.test(slot.model) || /free/i.test(slot.provider)
}

/**
 * 运行时生效顺序：ok 的 free 槽 → ok 的非 free 槽 → unknown（原配置序）→ dead（原配置序）。
 * 同档内保持配置相对顺序（stable sort）。纯函数，便于单测。
 */
export function orderSlots(
  configSlots: readonly ModelSlot[],
  statuses: ReadonlyMap<string, { status: SlotStatus; source: SlotSource }>,
): ModelSlot[] {
  const rank = (s: ModelSlot): number => {
    const entry = statuses.get(slotKey(s.provider, s.model))
    const status = entry?.status ?? 'unknown'
    if (status === 'ok') return isFreeSlot(s) ? 0 : 1
    if (status === 'unknown') return 2
    return 3
  }
  return configSlots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => rank(a.slot) - rank(b.slot) || a.index - b.index)
    .map(x => x.slot)
}

/**
 * provider 级重验 + model 级 TTL 复活：
 * - provider 不在已注册列表 → dead(source=provider)，可复活
 * - provider 在 且 之前是 model 级 dead：
 *     demotedAt 距今 < TTL → 维持 dead（防误杀复发）
 *     demotedAt 距今 ≥ TTL → 复活为 ok（条目级 TTL，不依赖整体缓存刷新）
 * - provider 在 且无历史 / 其他 → ok
 * 返回合并后的完整条目表（覆盖全部 configSlots）。纯函数，便于单测。
 */
export function mergeProviderValidation(
  configSlots: readonly ModelSlot[],
  registeredProviders: readonly string[],
  previous: ReadonlyMap<string, { status: SlotStatus; source: SlotSource; demotedAt?: string }>,
  now: number = Date.now(),
): Map<string, { status: SlotStatus; source: SlotSource; demotedAt?: string }> {
  const next = new Map<string, { status: SlotStatus; source: SlotSource; demotedAt?: string }>()
  for (const slot of configSlots) {
    const key = slotKey(slot.provider, slot.model)
    const prev = previous.get(key)
    if (!registeredProviders.includes(slot.provider)) {
      next.set(key, { status: 'dead', source: 'provider' })
    } else if (prev?.status === 'dead' && prev.source === 'model') {
      const demoted = prev.demotedAt ? Date.parse(prev.demotedAt) : NaN
      if (Number.isFinite(demoted) && now - demoted >= SLOT_CACHE_TTL_MS) {
        next.set(key, { status: 'ok', source: 'provider' }) // TTL 到 → 复活
      } else {
        next.set(key, { status: 'dead', source: 'model', demotedAt: prev.demotedAt }) // model 级死亡：条目级 TTL 内保留
      }
    } else {
      next.set(key, { status: 'ok', source: 'provider' })
    }
  }
  return next
}

/**
 * 可换模候选：运行时顺序中「非 dead」且「provider 本轮已注册」的槽。
 * 独立成纯函数——M1 修复：死槽（尤其 model-dead 但 provider 仍在）不得进候选，
 * 避免全部候选死光时反而绑定已知死模。
 */
export function availableCandidates(
  runtimeOrder: readonly ModelSlot[],
  registeredProviders: readonly string[],
  statuses: ReadonlyMap<string, { status: SlotStatus; source: SlotSource; demotedAt?: string }>,
): ModelSlot[] {
  return runtimeOrder.filter(s => {
    const e = statuses.get(slotKey(s.provider, s.model))
    return (e?.status ?? 'ok') !== 'dead' && registeredProviders.includes(s.provider)
  })
}

/**
 * 实际调用失败反馈（agent/request-error）：判定是否「模型不可用」类确定性失败。
 * 保守匹配——只认明确指向模型语义的 code/message：
 *   - 不认裸 status 404（网关/路由 404 与模型无关）
 *   - code 需含 model/no_adapter 语义
 *   - message 需同时含「模型语义词 + 不存在语义」，防子串误伤
 * 限流/超时/5xx 一律不淘汰。
 */
export function isModelUnavailableFailure(failure: { code?: unknown; status?: unknown; message?: unknown }): boolean {
  const code = String(failure.code ?? '').toLowerCase()
  const message = String(failure.message ?? '').toLowerCase()
  if (/no_adapter|model_not_found|invalid_model|unknown_model|unsupported_model|model_unavailable|no_such_model|not_found.*model|model.*not_found/.test(code)) return true
  const hasModelSemantic = /model|模型|模型名/.test(message)
  const hasMissingSemantic = /not found|no such|unknown|invalid|does not exist|unavailable|不存在|找不到|未知|无效|不支持|不可用|未找到/.test(message)
  return hasModelSemantic && hasMissingSemantic
}

/** 缓存是否可采纳：版本对 + 配置摘要一致 + 未过 TTL */
export function isCacheUsable(cache: SlotCacheFile | undefined, configHash: string, now: number = Date.now()): boolean {
  if (!cache || cache.v !== 1) return false
  if (cache.configHash !== configHash) return false
  const updated = Date.parse(cache.updatedAt)
  if (!Number.isFinite(updated)) return false
  return now - updated < SLOT_CACHE_TTL_MS
}
