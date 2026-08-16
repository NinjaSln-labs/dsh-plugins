/**
 * dsh-imgdraw — Host half.
 *
 * One plugin, four surfaces, one shared engine:
 * - `draw_image` model tool — synchronous text-to-image (awaits generation)
 * - `/imgdraw` prefix route — serves generated images from the out dir
 * - `/imgdraw-rpc` exact route — JSON RPC for the browser client (submit /
 *   status / latest / select / delete / backends); generation is ASYNC on
 *   this path (browser fetch has a 30s cap, generation takes longer)
 * - `~/.dsh/imgdraw/index.json` — persisted history (recent jobs, kept files,
 *   per-backend usage counter), reloaded on boot
 *
 * Engine rules:
 * - every generated file is written as `<outDir>/draw-<tag>-<ts>[-<i>].<ext>`
 * - keep-set: explicitly kept files + the newest `keepLatest` files; anything
 *   older is cleaned after each completed batch (in-flight downloads skipped)
 * - a restart interrupts running jobs; on boot they are marked `interrupted`
 *
 * 组合位置：host 平面（消费 webServer / tools / timer 注册表，不发布服务）。
 */
import { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, renameSync, existsSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  BACKEND_CATALOG,
  loadKeys,
  generateDashscope,
  generateSiliconflow,
  GenerateError,
  type BackendId,
  type BackendKeys,
  type GenerateRequest,
} from './generate.ts'

/** Plugin config; every field optional with a sane default. */
export interface ImgdrawConfig {
  /** Output directory for generated images (default ~/.dsh/imgdraw). */
  outDir?: string
  /** API keys JSON path (default ~/.dsh/image-api-keys.json). */
  keysPath?: string
  /** Image route prefix, no trailing slash (default /imgdraw). */
  routePrefix?: string
  /** RPC route path (default /imgdraw-rpc). */
  rpcPath?: string
  /** Keep newest N files per cleanup round (default 24). */
  keepLatest?: number
  /** Max images per request (default 4). */
  maxCount?: number
  /** Default backend (default dashscope). */
  defaultBackend?: BackendId
  /** DashScope model (default wan2.7-image). */
  dashscopeModel?: string
  /** SiliconFlow model (default Qwen/Qwen-Image). */
  siliconflowModel?: string
  /** Public origin for absolute image URLs (default derived from webServer). */
  publicOrigin?: string
  /** History cap in index.json (default 50 jobs). */
  historyCap?: number
}

export function resolveConfig(config: ImgdrawConfig = {}): Required<Pick<ImgdrawConfig, 'keepLatest' | 'maxCount' | 'defaultBackend' | 'dashscopeModel' | 'siliconflowModel' | 'historyCap'>> & ImgdrawConfig {
  const home = homedir()
  return {
    outDir: config.outDir ?? join(home, '.dsh', 'imgdraw'),
    keysPath: config.keysPath ?? join(home, '.dsh', 'image-api-keys.json'),
    routePrefix: config.routePrefix ?? '/imgdraw',
    rpcPath: config.rpcPath ?? '/imgdraw-rpc',
    keepLatest: config.keepLatest ?? 24,
    maxCount: config.maxCount ?? 4,
    defaultBackend: config.defaultBackend ?? 'dashscope',
    dashscopeModel: config.dashscopeModel ?? 'wan2.7-image',
    siliconflowModel: config.siliconflowModel ?? 'Qwen/Qwen-Image',
    publicOrigin: config.publicOrigin,
    historyCap: config.historyCap ?? 50,
  }
}

export interface JobFile {
  name: string
  url: string
  size: number
  ts: number
  kept: boolean
}

export interface JobRecord {
  jobId: string
  status: 'running' | 'done' | 'error' | 'interrupted'
  prompt: string
  backend: BackendId
  count: number
  size: string
  tag: string
  files: JobFile[]
  error?: string
  createdAt: number
  finishedAt?: number
}

export interface IndexFile {
  version: 1
  jobs: JobRecord[]
  kept: string[]
  quota: Partial<Record<BackendId, number>>
  updatedAt: number
}

const EMPTY_INDEX: IndexFile = { version: 1, jobs: [], kept: [], quota: {}, updatedAt: 0 }

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.json': 'application/json',
}

function safeName(raw: string): string | null {
  const name = basename(decodeURIComponent(raw))
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) return null
  if (name.length > 200) return null
  return name
}

export class ImgdrawEngine {
  readonly outDir: string
  readonly keysPath: string
  readonly routePrefix: string
  readonly rpcPath: string
  readonly keepLatest: number
  readonly maxCount: number
  readonly defaultBackend: BackendId
  readonly dashscopeModel: string
  readonly siliconflowModel: string
  readonly historyCap: number

  private index: IndexFile
  private readonly jobs = new Map<string, JobRecord>()
  private readonly inflight = new Set<string>()
  private readonly controllers = new Map<string, AbortController>()
  private keys: BackendKeys = {}

  constructor(config: ImgdrawConfig = {}) {
    const r = resolveConfig(config)
    this.outDir = r.outDir!
    this.keysPath = r.keysPath!
    this.routePrefix = r.routePrefix!
    this.rpcPath = r.rpcPath!
    this.keepLatest = r.keepLatest!
    this.maxCount = r.maxCount!
    this.defaultBackend = r.defaultBackend!
    this.dashscopeModel = r.dashscopeModel!
    this.siliconflowModel = r.siliconflowModel!
    this.historyCap = r.historyCap!

    mkdirSync(this.outDir, { recursive: true })
    this.keys = loadKeys(this.keysPath)
    this.index = this.loadIndex()
  }

  /** Reload API keys (cheap; called once at boot and on demand). */
  refreshKeys(): void {
    this.keys = loadKeys(this.keysPath)
  }

  // ---- persistence -----------------------------------------------------

  private loadIndex(): IndexFile {
    try {
      const raw = readFileSync(join(this.outDir, 'index.json'), 'utf8')
      const parsed = JSON.parse(raw) as IndexFile
      if (!Array.isArray(parsed.jobs) || !Array.isArray(parsed.kept)) return { ...EMPTY_INDEX }
      const idx: IndexFile = {
        version: 1,
        jobs: parsed.jobs.slice(0, this.historyCap),
        kept: parsed.kept.filter((n) => typeof n === 'string'),
        quota: parsed.quota ?? {},
        updatedAt: parsed.updatedAt ?? 0,
      }
      // 重启打断的 running 任务标记为 interrupted（历史保留，便于重新生成）。
      for (const j of idx.jobs) if (j.status === 'running') j.status = 'interrupted'
      for (const j of idx.jobs) {
        if (Array.isArray(j.files)) {
          for (const f of j.files) f.kept = idx.kept.includes(f.name)
        }
      }
      return idx
    } catch {
      return { ...EMPTY_INDEX }
    }
  }

  private persist(): void {
    this.index.updatedAt = Date.now()
    const tmp = join(this.outDir, `index.json.tmp-${process.pid}`)
    try {
      writeFileSync(tmp, JSON.stringify(this.index, null, 1))
      renameSync(tmp, join(this.outDir, 'index.json'))
    } catch (e) {
      console.error(`[imgdraw] index persist failed: ${String(e)}`)
      try { unlinkSync(tmp) } catch { /* ignore */ }
    }
  }

  // ---- queries ----------------------------------------------------------

  urlOf(name: string, origin?: string): string {
    const base = origin ?? this.cfgPublicOrigin ?? ''
    return `${base}${this.routePrefix}/${name}`
  }

  private cfgPublicOrigin: string | undefined

  setPublicOrigin(origin: string | undefined): void {
    this.cfgPublicOrigin = origin
  }

  jobView(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId)
  }

  latestView(limit = 40): { files: JobFile[]; jobs: JobRecord[]; quota: IndexFile['quota'] } {
    const files = this.scanFiles().slice(0, limit).map((n) => this.fileView(n))
    return { files, jobs: this.index.jobs.slice(0, limit), quota: { ...this.index.quota } }
  }

  private fileView(name: string): JobFile {
    const p = join(this.outDir, name)
    let size = 0
    try { size = statSync(p).size } catch { /* missing */ }
    let ts = 0
    try { ts = statSync(p).mtimeMs } catch { /* missing */ }
    return { name, url: this.urlOf(name), size, ts, kept: this.index.kept.includes(name) }
  }

  private scanFiles(): string[] {
    try {
      return readdirSync(this.outDir)
        .filter((n) => /^draw-.*\.(png|jpe?g|webp)$/i.test(n))
        .map((n) => ({ n, ts: statSync(join(this.outDir, n)).mtimeMs }))
        .sort((a, b) => b.ts - a.ts)
        .map((e) => e.n)
    } catch {
      return []
    }
  }

  backendsView(): Array<{ id: BackendId; label: string; model: string; keyPresent: boolean; quota: number; quotaHint: string; sizeHint: string }> {
    return BACKEND_CATALOG.map((b) => ({
      id: b.id,
      label: b.label,
      model: b.id === 'dashscope' ? this.dashscopeModel : this.siliconflowModel,
      keyPresent: Boolean(this.keys[b.id]),
      quota: this.index.quota[b.id] ?? 0,
      quotaHint: b.quotaHint,
      sizeHint: b.sizeHint,
    }))
  }

  // ---- mutations ----------------------------------------------------------

  setKept(name: string, keep: boolean): boolean {
    if (!safeName(name)) return false
    const p = join(this.outDir, name)
    if (!existsSync(p)) return false
    const set = new Set(this.index.kept)
    if (keep) set.add(name)
    else set.delete(name)
    this.index.kept = [...set]
    for (const j of this.index.jobs) {
      for (const f of j.files ?? []) if (f.name === name) f.kept = keep
    }
    this.persist()
    return true
  }

  isKept(name: string): boolean {
    return this.index.kept.includes(name)
  }

  deleteFile(name: string): boolean {
    const safe = safeName(name)
    if (!safe) return false
    const p = join(this.outDir, safe)
    try {
      if (!existsSync(p)) return false
      unlinkSync(p)
    } catch {
      return false
    }
    this.index.kept = this.index.kept.filter((n) => n !== safe)
    for (const j of this.index.jobs) j.files = (j.files ?? []).filter((f) => f.name !== safe)
    this.persist()
    return true
  }

  /**
   * Submit a generation. Returns immediately with a jobId; the job runs in the
   * background and updates the persisted index on completion.
   */
  submit(input: { prompt: string; count?: number; size?: string; backend?: BackendId; tag?: string }): { jobId: string; error?: string } {
    const prompt = String(input.prompt ?? '').trim()
    if (!prompt) return { jobId: '', error: '提示词不能为空' }
    const count = Math.max(1, Math.min(Math.trunc(input.count ?? 1), this.maxCount))
    const backend: BackendId = input.backend === 'siliconflow' ? 'siliconflow' : this.defaultBackend
    const size = String(input.size ?? '1024*1024').trim() || '1024*1024'
    const tag = String(input.tag ?? 'img').replace(/[^\w-]/g, '_').slice(0, 40) || 'img'

    const jobId = randomUUID().slice(0, 8)
    const job: JobRecord = {
      jobId,
      status: 'running',
      prompt,
      backend,
      count,
      size,
      tag,
      files: [],
      createdAt: Date.now(),
    }
    this.jobs.set(jobId, job)
    this.index.jobs = [job, ...this.index.jobs].slice(0, this.historyCap)
    this.persist()

    const controller = new AbortController()
    this.controllers.set(jobId, controller)
    void this.run(job, controller)
    return { jobId }
  }

  private async run(job: JobRecord, controller: AbortController): Promise<void> {
    const req: GenerateRequest = { prompt: job.prompt, count: job.count, size: job.size, backend: job.backend }
    try {
      const result = job.backend === 'siliconflow'
        ? await generateSiliconflow(this.keys, req, this.siliconflowModel, 'https://api.siliconflow.cn/v1/images/generations', controller.signal)
        : await generateDashscope(
            this.keys, req, this.dashscopeModel,
            'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
            'https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
            controller.signal,
          )

      const ts = Date.now()
      const files: JobFile[] = []
      for (let i = 0; i < result.files.length; i++) {
        const g = result.files[i]
        const name = `draw-${job.tag}-${ts}-${i}.${g.ext}`
        this.inflight.add(name)
        try {
          writeFileSync(join(this.outDir, name), g.bytes)
          const f = this.fileView(name)
          f.kept = this.index.kept.includes(name)
          files.push(f)
        } finally {
          this.inflight.delete(name)
        }
      }
      job.files = files
      job.status = 'done'
      job.finishedAt = Date.now()
      this.index.quota[job.backend] = (this.index.quota[job.backend] ?? 0) + 1
      this.persist()
      this.preClean()
    } catch (e) {
      job.status = 'error'
      job.finishedAt = Date.now()
      job.error = e instanceof Error ? (e instanceof GenerateError && e.detail ? `${e.message}：${e.detail}` : e.message) : String(e)
      this.persist()
    } finally {
      this.controllers.delete(job.jobId)
    }
  }

  /** Keep-set cleanup: kept files + newest keepLatest survive; the rest go. */
  preClean(): void {
    const kept = new Set(this.index.kept)
    const files = this.scanFiles()
    const survivors = new Set(files.slice(0, this.keepLatest))
    for (const name of files) {
      if (kept.has(name) || survivors.has(name) || this.inflight.has(name)) continue
      try {
        unlinkSync(join(this.outDir, name))
      } catch { /* already gone */ }
    }
  }

  /** Abort every running generation (plugin dispose). */
  abortAll(): void {
    for (const c of this.controllers.values()) c.abort()
    this.controllers.clear()
  }
}

// ---- HTTP ---------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function sendFile(res: ServerResponse, filePath: string): void {
  let st
  try {
    st = statSync(filePath)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('404 Not Found')
    return
  }
  if (!st.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('404 Not Found')
    return
  }
  const mime = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  res.writeHead(200, {
    'content-type': mime,
    'content-length': String(st.size),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  createReadStream(filePath).pipe(res)
}

// ---- plugin --------------------------------------------------------------

export const name = 'dsh-imgdraw'

/** Cordis plugin — OBJECT form (never a factory), see dsh-session-health notes. */
export default {
  name,
  apply(ctx: Context, config: ImgdrawConfig = {}): void {
    const engine = new ImgdrawEngine(config)

    // webServer routes — 用 ctx.inject 等待服务（bundle 在 boot 早期 apply，
    // ctx.get('webServer') 大概率是 undefined；inject 会在服务激活后回调）。
    ctx.inject(['webServer'], (wsCtx) => {
      const webServer = (wsCtx as unknown as {
        webServer: { register(route: unknown): () => void; port?: number; host?: string }
      }).webServer
      const disposers: Array<() => void> = []
      try {
        const origin = config.publicOrigin
          ?? (webServer.port ? `http://${webServer.host ?? '127.0.0.1'}:${webServer.port}` : undefined)
        engine.setPublicOrigin(origin)

        // GET /imgdraw[/<file>] — image files + root JSON listing.
        disposers.push(webServer.register({
          kind: 'prefix',
          path: engine.routePrefix,
          handler: (req: IncomingMessage, res: ServerResponse) => {
            const pathname = (req.url ?? '/').split('?')[0] ?? '/'
            const rest = pathname.slice(engine.routePrefix.length)
            if (rest === '' || rest === '/') {
              const view = engine.latestView(40)
              sendJson(res, 200, { ok: true, route: engine.routePrefix, files: view.files })
              return
            }
            const name = safeName(rest.replace(/^\/+/, ''))
            if (!name) {
              sendJson(res, 400, { ok: false, error: 'invalid name' })
              return
            }
            sendFile(res, join(engine.outDir, name))
          },
        }))

        // POST /imgdraw-rpc — browser JSON RPC.
        disposers.push(webServer.register({
          kind: 'exact',
          path: engine.rpcPath,
          handler: async (req: IncomingMessage, res: ServerResponse) => {
            if (req.method !== 'POST') {
              sendJson(res, 405, { ok: false, error: 'POST only' })
              return
            }
            let call: { method?: string; args?: Record<string, any> }
            try {
              call = JSON.parse(await readBody(req)) as { method?: string; args?: Record<string, any> }
            } catch {
              sendJson(res, 400, { ok: false, error: 'invalid json' })
              return
            }
            try {
              const result = dispatchRpc(engine, call.method ?? '', call.args ?? {})
              sendJson(res, 200, { ok: true, result })
            } catch (e) {
              sendJson(res, 200, { ok: false, error: e instanceof Error ? e.message : String(e) })
            }
          },
        }))
      } catch (e) {
        console.error(`[imgdraw] route registration failed: ${String(e)}`)
        for (const d of disposers) { try { d() } catch { /* ignore */ } }
      }
      ctx.effect(() => () => {
        for (const d of disposers) { try { d() } catch { /* ignore */ } }
      })
    })

    // draw_image tool (hard dependency: the tool registry).
    ctx.inject(['tools'], (toolsCtx) => {
      toolsCtx.tools.register(defineTool({
        name: 'draw_image',
        description: '文生图：按提示词生成图片（异步后端，等待完成后返回文件列表）。'
          + '后端默认百炼 wan2.7-image（免费额度），可选 SiliconFlow Qwen-Image。'
          + 'size 支持 1024*1024 / 1280*720 / 720*1280 / 1536*1024 / 1K / 2K。'
          + '生成的文件通过 /imgdraw/ 路由访问（http://127.0.0.1:3080/imgdraw/<文件名>）。',
        parameters: {
          prompt: { type: 'string', required: true, description: '详细画面描述（中文/英文均可），越具体越好' },
          count: { type: 'number', description: '生成数量 1-4，默认 1' },
          size: { type: 'string', description: '尺寸，默认 1024*1024' },
          backend: { type: 'string', enum: ['dashscope', 'siliconflow'], description: '默认 dashscope（百炼 wan2.7-image，免费）；siliconflow = Qwen-Image' },
          tag: { type: 'string', description: '文件名标签（可选，默认 img；如 sin）' },
        },
        output: { schema: { type: 'json' }, render: renderJson },
        timeoutMs: 180_000,
        async execute(args: Record<string, any>, exec: { signal?: AbortSignal }) {
          const submitted = engine.submit({
            prompt: args.prompt,
            count: args.count,
            size: args.size,
            backend: args.backend,
            tag: args.tag,
          })
          if (submitted.error || !submitted.jobId) {
            throw new Error(submitted.error ?? '提交失败')
          }
          // 轮询直到完成（工具路径等待完整生成；客户端 RPC 路径走异步轮询）。
          const deadline = Date.now() + 170_000
          for (;;) {
            const job = engine.jobView(submitted.jobId)
            if (job) {
              if (job.status === 'done') {
                return {
                  backend: job.backend,
                  count: job.files.length,
                  files: job.files.map((f) => ({ name: f.name, url: f.url, size: f.size })),
                  prompt: job.prompt,
                }
              }
              if (job.status === 'error' || job.status === 'interrupted') {
                throw new Error(job.error ?? '生成失败')
              }
            }
            if (exec?.signal?.aborted) throw new Error('生成已取消')
            if (Date.now() > deadline) throw new Error('生成超时（>170s），请用客户端弹窗查看任务状态')
            await sleep(1500)
          }
        },
      }))
    })

    // 插件停止时中断所有进行中的生成。
    ctx.effect(() => () => engine.abortAll())
  },
}

function renderJson(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---- RPC dispatch ---------------------------------------------------------

function dispatchRpc(engine: ImgdrawEngine, method: string, args: Record<string, any>): unknown {
  switch (method) {
    case 'submit': {
      const r = engine.submit({
        prompt: args.prompt,
        count: args.count,
        size: args.size,
        backend: args.backend,
        tag: args.tag,
      })
      if (r.error) throw new Error(r.error)
      return { jobId: r.jobId }
    }
    case 'status': {
      const job = engine.jobView(String(args.jobId ?? ''))
      if (!job) throw new Error('任务不存在')
      return {
        jobId: job.jobId,
        status: job.status,
        prompt: job.prompt,
        backend: job.backend,
        files: job.files,
        error: job.error,
        createdAt: job.createdAt,
        finishedAt: job.finishedAt,
      }
    }
    case 'latest':
      return engine.latestView(40)
    case 'select': {
      const ok = engine.setKept(String(args.name ?? ''), Boolean(args.keep))
      if (!ok) throw new Error('文件不存在或名称非法')
      return { kept: engine.isKept(String(args.name)) }
    }
    case 'delete': {
      if (!engine.deleteFile(String(args.name ?? ''))) throw new Error('文件不存在或名称非法')
      return { deleted: true }
    }
    case 'backends':
      return { backends: engine.backendsView() }
    case 'refresh-keys':
      engine.refreshKeys()
      return { ok: true }
    default:
      throw new Error(`未知方法: ${method}`)
  }
}
