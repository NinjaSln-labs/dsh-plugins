/**
 * dsh-context-compass — S1 live 契约检查（contract-check）。
 *
 * 对运行中的真 harness 断言插件仍挂载、Host 半注入链路可用。DSH 处在 rc
 * 阶段，契约可能持续变动，因此本脚本只依赖一个稳定事实：插件注册的
 * `/context-compass-rpc` 路由（loopback-only）只在 Host 半成功挂载 +
 * webServer 注入成功时才存在；overview handler 内部真实调用注入服务
 * （sessionQuery / sessionProjectionCache / workspaceRegistry / sessions /
 * agents / sessionTitle）。
 *
 * 判别器（对应 src/overview.ts 的响应语义）：
 *   - 404                          → 路由不存在 → 插件未挂载/挂载失败（升级 API 漂移）
 *   - 400 "invalid json"           → 路由是插件 handler 的 → 挂载 + webServer 注入成功
 *   - 400 "unknown method"         → handler 派发逻辑活着
 *   - 200 { ok:true, result.sessions } → overview 注入服务链真实可用
 *   - 连接被拒（ECONNREFUSED）      → harness 未运行 → 跳过（exit 2，非插件失败）
 *
 *   注入服务形状漂移时，插件按防御设计逐处降级（overview 仍返回 200），所以本
 *   脚本捕获的是「升级后插件整体未能挂载/路由丢失」这一最大漂移形态；这符合
 *   rc 阶段"能起作用即可"的要求。真正逐服务形状校验需人工扫描（见 ROADMAP 升级体检基线）。
 *
 *   node scripts/contract-check.mjs            # 默认 http://127.0.0.1:3080
 *   DSH_WEB_URL=... node scripts/contract-check.mjs
 */
import { request } from 'node:http'

const base = process.env.DSH_WEB_URL || 'http://127.0.0.1:3080'
const BASE_URL = new URL(base)

/** POST 一段原文 body（raw，非 JSON.stringify，用于测非法 JSON）。 */
function postRaw(path, raw) {
  return new Promise((resolve) => {
    const req = request(
      { hostname: BASE_URL.hostname, port: BASE_URL.port, path, method: 'POST', headers: { 'content-type': 'application/json' } },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => resolve({ status: res.statusCode, body: data }))
      },
    )
    req.on('error', (e) => resolve({ error: e }))
    req.end(raw)
  })
}

/** POST 一段 JSON body。 */
function postJson(path, payload) {
  return postRaw(path, JSON.stringify(payload))
}

const RPC = '/context-compass-rpc'
let failed = 0

function pass(name, detail) { console.log(`✅ ${name}${detail ? ` — ${detail}` : ''}`) }
function fail(name, detail) { console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`); failed++ }

async function main() {
  console.log(`\n=== dsh-context-compass live 契约检查 ===`)
  console.log(`目标 harness: ${base}\n`)

  // 1) 连通性 + 路由存在性：POST 非法 JSON。
  const probe = await postRaw(RPC, '{ bad json')
  if (probe.error || probe.status === undefined) {
    console.log(`⚠️  harness 未运行（${probe.error?.code ?? 'connection failed'}）——跳过契约检查（exit 2，非插件问题）`)
    process.exit(2)
  }
  if (probe.status === 404) {
    fail('插件 RPC 路由存在', `/${RPC} 返回 404 —— 插件未挂载或 webServer 注入后未能注册路由（升级 API 漂移？）`)
    console.log('')
    process.exit(1)
  }
  if (probe.status === 400 && probe.body.includes('invalid json')) {
    pass('插件 RPC 路由存在', 'POST 非法 JSON → 400 "invalid json"（路由是插件的 handler）')
  } else if (probe.status === 403) {
    fail('loopback 可达', `返回 403 loopback only —— 本脚本非 loopback 访问？`)
  } else {
    fail('插件 RPC 路由存在', `POST 非法 JSON → ${probe.status} ${probe.body.slice(0, 60)}（期望 400 invalid json）`)
  }

  if (failed) { console.log(''); process.exit(1) }

  // 2) handler 派发逻辑：未知 method → 400 "unknown method"。
  const unk = await postJson(RPC, { method: 'not-a-real-method' })
  if (unk.status === 400 && unk.body.includes('unknown method')) {
    pass('handler 派发逻辑', '未知 method → 400 "unknown method"')
  } else {
    fail('handler 派发逻辑', `未知 method → ${unk.status} ${unk.body.slice(0, 60)}`)
  }

  if (failed) { console.log(''); process.exit(1) }

  // 3) overview 服务链：{method:'overview'} → 200 ok:true + result.sessions 数组。
  const ov = await postJson(RPC, { method: 'overview' })
  let okOverview = ov.status === 200
  if (okOverview) {
    try { const j = JSON.parse(ov.body); okOverview = j?.ok === true && Array.isArray(j?.result?.sessions) } catch { okOverview = false }
  }
  if (okOverview) {
    pass('overview 注入服务链', 'POST {method:overview} → 200 ok:true + result.sessions[]')
  } else {
    fail('overview 注入服务链', `POST {method:overview} → ${ov.status} ${ov.body.slice(0, 80)}`)
  }

  console.log('')
  if (failed) {
    console.log(`❌ ${failed} 项失败 —— 升级漂移或挂载异常，禁止发布\n`)
    process.exit(1)
  } else {
    console.log(`✅ 全部通过 —— 插件在 ${base} 上挂载且注入链路可用\n`)
    process.exit(0)
  }
}

main()
