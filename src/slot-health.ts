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
 * provider 级重验：provider 不在已注册列表 → dead(source=provider)；
 * provider 在 → 维持原状态（model 级 dead 不因 provider 复活而复活，等 TTL 重建）；
 * 无历史 → ok。
 * 返回合并后的完整条目表（覆盖全部 configSlots）。纯函数，便于单测。
 */
export function mergeProviderValidation(
  configSlots: readonly ModelSlot[],
  registeredProviders: readonly string[],
  previous: ReadonlyMap<string, { status: SlotStatus; source: SlotSource }>,
): Map<string, { status: SlotStatus; source: SlotSource }> {
  const next = new Map<string, { status: SlotStatus; source: SlotSource }>()
  for (const slot of configSlots) {
    const key = slotKey(slot.provider, slot.model)
    const prev = previous.get(key)
    if (!registeredProviders.includes(slot.provider)) {
      next.set(key, { status: 'dead', source: 'provider' })
    } else if (prev?.status === 'dead' && prev.source === 'model') {
      next.set(key, { status: 'dead', source: 'model' }) // model 级死亡只在 TTL 重建时复活
    } else {
      next.set(key, { status: 'ok', source: 'provider' })
    }
  }
  return next
}

/**
 * 实际调用失败反馈（agent/request-error）：判定是否「模型不可用」类确定性失败。
 * 保守匹配——只认明确语义，限流/超时/5xx 一律不淘汰。
 */
export function isModelUnavailableFailure(failure: { code?: unknown; status?: unknown; message?: unknown }): boolean {
  const code = String(failure.code ?? '').toLowerCase()
  const status = Number(failure.status ?? 0)
  const message = String(failure.message ?? '').toLowerCase()
  if (status === 404) return true
  if (/no_adapter|not_found|model_not_found|invalid_model|unknown_model|unsupported_model|model_unavailable|no_such_model/.test(code)) return true
  if (/not found|no such model|unknown model|invalid model|does not exist|model unavailable|unsupported model|模型不存在|不存在该模型|不支持的模型|模型不可用|未找到模型/.test(message)) return true
  return false
}

/** 缓存是否可采纳：版本对 + 配置摘要一致 + 未过 TTL */
export function isCacheUsable(cache: SlotCacheFile | undefined, configHash: string, now: number = Date.now()): boolean {
  if (!cache || cache.v !== 1) return false
  if (cache.configHash !== configHash) return false
  const updated = Date.parse(cache.updatedAt)
  if (!Number.isFinite(updated)) return false
  return now - updated < SLOT_CACHE_TTL_MS
}
