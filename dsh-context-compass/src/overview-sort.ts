/**
 * dsh-context-compass — overview 排序规则（host/client 单源共享模块）。
 *
 * 排序优先级（方案 A，0.7.15 定稿，host 与 client 双侧同规则）：
 *   运行中置顶（跨 severity tier，且运行中组内仍按 红→黄→蓝→绿）→
 *   严重度档位 红→黄→蓝→绿→未知 → 活动三态 运行中→已加载→冷却 →
 *   最新创建在前。
 *
 * OV-5 治愈：此前 host（overview.ts）与 client（client/overview.tsx）各自
 * 维护一份逐行等价的排序实现，仅靠注释约定同源。现收敛至此纯函数模块。
 * client bundle（esbuild 打包 src/client.tsx）可直接打包本模块——它与
 * util/types/knowledge 同为纯源码，零 host-only 依赖。
 */
import type { HealthSeverity, SessionActivity, SessionHealthProjection } from './types.ts'

/** 排序用 severity 档位：红最前，黄/蓝/绿依次，未知最后。 */
const SEVERITY_RANK: Record<HealthSeverity, number> = { red: 0, yellow: 1, blue: 2, green: 3 }

/** 排序所需的最小行形状（host OverviewRow / client OverviewRowLike 皆其超集）。 */
export interface SortableOverviewRow {
  status: SessionActivity | null | undefined
  health: SessionHealthProjection | null | undefined
  createdAt: number | null | undefined
}

/** Severity 排序档位：红最前 → 黄/蓝/绿 → 未知（null/undefined）最后。 */
export function rankOf(health: SessionHealthProjection | null | undefined): number {
  if (health === undefined || health === null) return 4
  return SEVERITY_RANK[health.severity] ?? 4
}

/** 活动三态排序档位：运行中 → 已加载 → 冷却。 */
function activityRankOf(status: SessionActivity | null | undefined): number {
  return status === 'running' ? 0 : status === 'loaded' ? 1 : 2
}

/**
 * 稳定排序（方案 A）：运行中置顶 → severity 档位 → 活动三态 → 最新创建在前。
 * 纯函数：不修改入参，返回新数组；泛型保留具体行类型。
 */
export function sortOverviewRows<T extends SortableOverviewRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    // Running agents first regardless of severity tier (2026-08-22 反馈),
    // and within the running group severity still orders — a running yellow
    // outranks a running green. Non-running rows keep the severity ladder.
    const arn = a.status === 'running'
    const brn = b.status === 'running'
    if (arn !== brn) return arn ? -1 : 1
    const ra = rankOf(a.health)
    const rb = rankOf(b.health)
    if (ra !== rb) return ra - rb
    const la = activityRankOf(a.status)
    const lb = activityRankOf(b.status)
    if (la !== lb) return la - lb
    return (b.createdAt ?? 0) - (a.createdAt ?? 0)
  })
}
