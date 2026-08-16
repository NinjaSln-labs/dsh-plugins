/**
 * dsh-imgdraw — generation engine.
 *
 * Two backends, both synchronous HTTP APIs called with Node `fetch`:
 *
 * - `dashscope` (default): 阿里云百炼 multimodal-generation/generation
 *   endpoint. Default model `wan2.7-image` (free quota, see ROADMAP); the
 *   response returns presigned image URLs that we download locally. Domestic
 *   endpoint first, international fallback on network failure.
 *   See https://docs.qwencloud.com/api-reference/image-generation/wan27-image-gen-edit/synchronous
 * - `siliconflow`: SiliconFlow images/generations endpoint, model
 *   `Qwen/Qwen-Image` (b64_json or URL per image).
 *
 * API keys are read from the keys JSON file ({dashscope, siliconflow, ...}).
 * Output bytes are returned to the caller, which owns writing them into the
 * out dir (keeps a single naming/cleanup policy in the engine host).
 */
import { readFileSync } from 'node:fs'

export type BackendId = 'dashscope' | 'siliconflow'

export interface GenerateRequest {
  prompt: string
  count: number
  size: string
  backend: BackendId
}

export interface GeneratedImage {
  /** Suggested file extension without dot (png/jpg). */
  ext: string
  bytes: Uint8Array
}

export interface GenerateResult {
  files: GeneratedImage[]
  usedModel: string
  note?: string
}

export interface BackendKeys {
  dashscope?: string
  siliconflow?: string
  gemini?: string
  volc?: string
  stability?: string
  proxy?: string
}

export interface BackendCatalogEntry {
  id: BackendId
  label: string
  model: string
  quotaHint: string
  sizeHint: string
}

export const BACKEND_CATALOG: BackendCatalogEntry[] = [
  {
    id: 'dashscope',
    label: '百炼 wan2.7-image（免费）',
    model: 'wan2.7-image',
    quotaHint: '免费 50 次（2026-11-14 到期）',
    sizeHint: '1K / 2K / 宽*高',
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow Qwen-Image（券）',
    model: 'Qwen/Qwen-Image',
    quotaHint: '按账户余额/券',
    sizeHint: '1024x1024 等',
  },
]

export class GenerateError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message)
  }
}

export function loadKeys(keysPath: string): BackendKeys {
  try {
    const raw = readFileSync(keysPath, 'utf8')
    return JSON.parse(raw) as BackendKeys
  } catch {
    return {}
  }
}

function parseJson(res: Response): Promise<unknown> {
  return res.text().then((t) => {
    try {
      return JSON.parse(t)
    } catch {
      return { raw: t.slice(0, 500) }
    }
  })
}

async function download(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new GenerateError(`下载图片失败 HTTP ${res.status}`, url.slice(0, 160))
  const buf = await res.arrayBuffer()
  if (buf.byteLength === 0) throw new GenerateError('下载图片为空', url.slice(0, 160))
  return new Uint8Array(buf)
}

/** Map a friendly size string to the DashScope `size` parameter. */
export function dashscopeSize(size: string): string {
  const s = size.trim()
  if (s === '') return '1024*1024'
  return s
}

/** Map a friendly size string to the SiliconFlow `image_size` parameter. */
export function siliconflowSize(size: string): string {
  const s = size.trim()
  if (s === '1K') return '1024x1024'
  if (s === '2K') return '2048x2048'
  return s.replace(/\*/g, 'x')
}

/**
 * Run one DashScope multimodal-generation call (synchronous). `n` images come
 * back as presigned URLs inside output.choices[0].message.content[].image.
 */
export async function generateDashscope(
  keys: BackendKeys,
  req: GenerateRequest,
  model: string,
  endpoint: string,
  fallbackEndpoint: string,
  signal?: AbortSignal,
): Promise<GenerateResult> {
  const key = keys.dashscope
  if (!key) throw new GenerateError('dashscope key 未配置（~/.dsh/image-api-keys.json 的 dashscope 字段）')

  const body = {
    model,
    input: { messages: [{ role: 'user', content: [{ text: req.prompt }] }] },
    parameters: { n: req.count, size: dashscopeSize(req.size), watermark: false },
  }

  let lastErr: Error | null = null
  for (const url of [endpoint, fallbackEndpoint]) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal,
      })
      const json = (await parseJson(res)) as Record<string, any>
      if (!res.ok) {
        const detail = json?.message ?? json?.error?.message ?? JSON.stringify(json).slice(0, 300)
        throw new GenerateError(`百炼 API HTTP ${res.status}`, String(detail))
      }
      const content: any[] = json?.output?.choices?.[0]?.message?.content ?? []
      const urls: string[] = content
        .filter((c) => typeof c?.image === 'string')
        .map((c) => c.image as string)
      if (urls.length === 0) {
        throw new GenerateError('百炼响应中没有图片', JSON.stringify(json).slice(0, 400))
      }
      const files: GeneratedImage[] = []
      for (const u of urls) {
        const bytes = await download(u, signal)
        const ext = /\.(png|jpe?g|webp)/i.exec(u)?.[1]?.toLowerCase().replace('jpeg', 'jpg') ?? 'png'
        files.push({ ext, bytes })
      }
      return { files, usedModel: model }
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
      // 只在端点本身不可达时尝试备用端点（intl 域名），业务错误直接抛出。
      if (e instanceof GenerateError && !/fetch failed|ENOTFOUND|ECONNREFUSED/i.test(e.message)) throw e
    }
  }
  throw lastErr ?? new GenerateError('百炼调用失败')
}

/**
 * Run one SiliconFlow images/generations call. `batch_size` images come back
 * as data[].b64_json (or data[].url).
 */
export async function generateSiliconflow(
  keys: BackendKeys,
  req: GenerateRequest,
  model: string,
  endpoint: string,
  signal?: AbortSignal,
): Promise<GenerateResult> {
  const key = keys.siliconflow
  if (!key) throw new GenerateError('siliconflow key 未配置（~/.dsh/image-api-keys.json 的 siliconflow 字段）')

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      prompt: req.prompt,
      image_size: siliconflowSize(req.size),
      batch_size: req.count,
    }),
    signal,
  })
  const json = (await parseJson(res)) as Record<string, any>
  if (!res.ok) {
    const detail = json?.message ?? json?.error?.message ?? JSON.stringify(json).slice(0, 300)
    throw new GenerateError(`SiliconFlow API HTTP ${res.status}`, String(detail))
  }
  const data: any[] = Array.isArray(json?.data) ? json.data : []
  if (data.length === 0) {
    throw new GenerateError('SiliconFlow 响应中没有图片', JSON.stringify(json).slice(0, 400))
  }
  const files: GeneratedImage[] = []
  for (const item of data) {
    if (typeof item?.b64_json === 'string') {
      const bytes = new Uint8Array(Buffer.from(item.b64_json, 'base64'))
      files.push({ ext: 'png', bytes })
    } else if (typeof item?.url === 'string') {
      const bytes = await download(item.url, signal)
      const ext = /\.(png|jpe?g|webp)/i.exec(item.url)?.[1]?.toLowerCase().replace('jpeg', 'jpg') ?? 'png'
      files.push({ ext, bytes })
    }
  }
  if (files.length === 0) throw new GenerateError('SiliconFlow 图片数据无法解析', JSON.stringify(json).slice(0, 400))
  return { files, usedModel: model }
}
