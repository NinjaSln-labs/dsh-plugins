/**
 * dsh-imgdraw — Client half.
 *
 * Renders a 生图 button in `conversation.input.left` (left end of the composer
 * tool row, native style) that opens a popup in `conversation.input.overlay`:
 * prompt (+ Sin v10 基础模板 preset), size / count / backend selects with
 * per-backend usage, async generation with polling, 4-grid results with
 * download / keep(保留) / delete actions, and a recent history list with
 * regenerate.
 *
 * RPC path: same-origin POST to /imgdraw-rpc (bundle plugins have no
 * harness.handle host bridge; the host half owns the route).
 */
import * as React from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (input.left / input.overlay seats).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

const RPC_PATH = '/imgdraw-rpc'
const ROUTE_PREFIX = '/imgdraw'
const POLL_MS = 2000

/** Sin v10 定稿提示词（generated-images/base-prompt.md 英文版，模板预设）。 */
const TEMPLATE_SIN_V10 = `Cyberpunk avatar icon: the word "Sin" is the only subject.
The letters form a WILD, CHAOTIC COMPOSITION: each letter is ROTATED and TILTED at a different angle, NOT aligned on a horizontal baseline, letters overlap and stack on each other haphazardly, like letters thrown and tumbling through the air — uneven spacing, some letters bigger some smaller, the whole word feels unstable and in motion. The letterforms themselves are VIOLENT, FRANTIC, SAVAGE: jagged spiky shapes, aggressive slashes, distorted beyond any formal typeface, barely holding together but still readable — NOT neat, NOT tidy, NOT symmetric, NOT a formal font. Neon shards and light particles scatter from the rough letter edges. The letters are HOLLOW and TRANSPARENT inside: no fill color at all — the background ink-splash graffiti pattern shows THROUGH the letter interiors. The letters are defined by neon-tube outlines at MAXIMUM brightness and saturation, THICK and bolder, blazing with electric glow, and each letter has a DEEP, WIDE dark inner edge separating it from the background — the highest possible contrast so "Sin" jumps out instantly. NO white outlines, NO solid yellow outlines.
The whole image is one continuous flow of neon light: letters, shards and background belong to the same light field, fragments dissolve naturally into the surrounding glow.
The background is a vibrant neon gradient in cyberpunk street ink-splash graffiti style, EXPLODING OUTWARD FROM THE CENTER LIKE A VOLCANIC ERUPTION OF NEON INK with HEAVY, DENSE ink — a massive radial blast, waves of magenta, cyan and purple ink bursting violently from the center, thick saturated ink pools and rivers of paint, heavy dripping ink trails, dense flying splatters and paint slashes covering the frame edges, yellow highlights, light streaks and neon haze spreading everywhere; bright, no black, no city, no street.
Keep electric static noise, scanlines and VHS grain texture.
No people, no faces, no other text, no watermark. Square avatar format, high detail.`

const SIZES = ['1024*1024', '1280*720', '720*1280', '1536*1024', '1K', '2K']

// ---- store ----------------------------------------------------------------

interface JobFile {
  name: string
  url: string
  size: number
  ts: number
  kept: boolean
}

interface JobView {
  jobId: string
  status: 'running' | 'done' | 'error' | 'interrupted'
  prompt: string
  backend: string
  files: JobFile[]
  error?: string
  createdAt: number
  finishedAt?: number
}

interface BackendView {
  id: string
  label: string
  model: string
  keyPresent: boolean
  quota: number
  quotaHint: string
  sizeHint: string
}

interface DrawStore {
  open: boolean
  prompt: string
  size: string
  count: number
  backend: string
  busy: boolean
  jobs: JobView[]
  recent: JobFile[]
  quota: Record<string, number>
  backends: BackendView[]
  error: string | null
}

const initialStore: DrawStore = {
  open: false,
  prompt: '',
  size: '1024*1024',
  count: 1,
  backend: 'dashscope',
  busy: false,
  jobs: [],
  recent: [],
  quota: {},
  backends: [],
  error: null,
}

let store: DrawStore = { ...initialStore }
const listeners = new Set<() => void>()

function setStore(patch: Partial<DrawStore>): void {
  store = { ...store, ...patch }
  for (const l of [...listeners]) l()
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getSnapshot(): DrawStore {
  return store
}

async function rpc(method: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(RPC_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, args }),
  })
  const body = await res.json().catch(() => null)
  if (!body || body.ok !== true) {
    throw new Error(body?.error ?? `RPC ${method} 失败 (HTTP ${res.status})`)
  }
  return body.result
}

function openPopup(): void {
  setStore({ open: true, error: null })
  void refreshAll()
}

function closePopup(): void {
  setStore({ open: false })
}

async function refreshAll(): Promise<void> {
  try {
    const [latest, b] = await Promise.all([rpc('latest'), rpc('backends')])
    setStore({
      recent: latest.files ?? [],
      jobs: (latest.jobs ?? []).map(normalizeJob),
      quota: latest.quota ?? {},
      backends: b.backends ?? [],
      busy: store.busy,
    })
  } catch (e) {
    setStore({ error: e instanceof Error ? e.message : String(e) })
  }
}

function normalizeJob(j: any): JobView {
  return {
    jobId: String(j.jobId ?? ''),
    status: j.status ?? 'interrupted',
    prompt: String(j.prompt ?? ''),
    backend: String(j.backend ?? ''),
    files: Array.isArray(j.files) ? j.files : [],
    error: j.error,
    createdAt: Number(j.createdAt ?? 0),
    finishedAt: j.finishedAt,
  }
}

async function submitGeneration(): Promise<void> {
  const prompt = store.prompt.trim()
  if (!prompt) {
    setStore({ error: '提示词不能为空' })
    return
  }
  setStore({ busy: true, error: null })
  try {
    const { jobId } = await rpc('submit', {
      prompt,
      count: store.count,
      size: store.size,
      backend: store.backend,
    })
    const job: JobView = {
      jobId: String(jobId),
      status: 'running',
      prompt,
      backend: store.backend,
      files: [],
      createdAt: Date.now(),
    }
    setStore({ jobs: [job, ...store.jobs], busy: false })
  } catch (e) {
    setStore({ busy: false, error: e instanceof Error ? e.message : String(e) })
  }
}

async function pollRunning(): Promise<void> {
  const running = store.jobs.filter((j) => j.status === 'running')
  if (running.length === 0) return
  const updated = await Promise.all(running.map(async (j) => {
    try {
      return normalizeJob(await rpc('status', { jobId: j.jobId }))
    } catch {
      return j
    }
  }))
  const byId = new Map(updated.map((j) => [j.jobId, j]))
  setStore({
    jobs: store.jobs.map((j) => byId.get(j.jobId) ?? j),
    busy: store.busy,
  })
  // 任务完成时顺带刷新 recent + quota。
  if (updated.some((j) => j.status !== 'running')) {
    try {
      const latest = await rpc('latest')
      setStore({ recent: latest.files ?? [], quota: latest.quota ?? {} })
    } catch { /* ignore */ }
  }
}

async function toggleKeep(name: string, keep: boolean): Promise<void> {
  try {
    await rpc('select', { name, keep })
    await refreshAll()
  } catch (e) {
    setStore({ error: e instanceof Error ? e.message : String(e) })
  }
}

async function removeFile(name: string): Promise<void> {
  try {
    await rpc('delete', { name })
    await refreshAll()
  } catch (e) {
    setStore({ error: e instanceof Error ? e.message : String(e) })
  }
}

function regenerate(job: JobView): void {
  setStore({ prompt: job.prompt, error: null })
  void submitGeneration()
}

// ---- components -------------------------------------------------------------

function useDrawStore(): DrawStore {
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function DrawButton(_props: Record<string, unknown>): React.ReactElement {
  return React.createElement(
    'button',
    {
      type: 'button',
      className: 'imgdraw-btn',
      title: '文生图（dsh-imgdraw）',
      onClick: () => openPopup(),
      'aria-label': '生图',
    },
    '🎨 生图',
  )
}

function FileActions({ file }: { file: JobFile }): React.ReactElement {
  const [pending, setPending] = React.useState(false)
  const act = (fn: () => Promise<void>): void => {
    setPending(true)
    void fn().finally(() => setPending(false))
  }
  return React.createElement(
    'div',
    { className: 'imgdraw-file-actions' },
    React.createElement(
      'a',
      { className: 'imgdraw-mini', href: file.url, download: file.name, title: '下载' },
      '下载',
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        className: `imgdraw-mini ${file.kept ? 'imgdraw-kept' : ''}`,
        disabled: pending,
        onClick: () => act(() => toggleKeep(file.name, !file.kept)),
        title: '选定保留（自动清理时不被删除）',
      },
      file.kept ? '✓ 已保留' : '保留',
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'imgdraw-mini imgdraw-danger',
        disabled: pending,
        onClick: () => act(() => removeFile(file.name)),
        title: '删除',
      },
      '删除',
    ),
  )
}

function JobCard({ job }: { job: JobView }): React.ReactElement | null {
  if (job.status === 'running') {
    return React.createElement(
      'div',
      { className: 'imgdraw-job imgdraw-running' },
      React.createElement('div', { className: 'imgdraw-job-head' },
        React.createElement('span', null, '⏳ 生成中…'),
        React.createElement('span', { className: 'imgdraw-muted' }, `${job.backend} · ${job.prompt.slice(0, 40)}`),
      ),
    )
  }
  if (job.status === 'error' || job.status === 'interrupted') {
    return React.createElement(
      'div',
      { className: 'imgdraw-job imgdraw-job-error' },
      React.createElement('div', { className: 'imgdraw-job-head' },
        React.createElement('span', null, '❌ 生成失败'),
        React.createElement('span', { className: 'imgdraw-muted' }, `${job.backend} · ${job.prompt.slice(0, 40)}`),
      ),
      React.createElement('div', { className: 'imgdraw-err' }, job.error ?? '未知错误'),
    )
  }
  return React.createElement(
    'div',
    { className: 'imgdraw-job' },
    React.createElement('div', { className: 'imgdraw-job-head' },
      React.createElement('span', null, `✅ ${job.files.length} 张 · ${job.backend}`),
      React.createElement(
        'button',
        { type: 'button', className: 'imgdraw-mini', onClick: () => regenerate(job) },
        '↻ 重新生成',
      ),
    ),
    React.createElement('div', { className: 'imgdraw-grid' },
      ...job.files.map((f) => React.createElement(
        'figure',
        { key: f.name, className: 'imgdraw-cell' },
        React.createElement('img', { src: f.url, alt: f.name, loading: 'lazy' }),
        React.createElement('figcaption', null,
          React.createElement('span', { className: 'imgdraw-fname', title: f.name }, f.name),
          React.createElement(FileActions, { file: f }),
        ),
      )),
    ),
  )
}

function DrawPopup(_props: Record<string, unknown>): React.ReactElement | null {
  const s = useDrawStore()
  const [polling, setPolling] = React.useState(false)

  React.useEffect(() => {
    if (!s.open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closePopup()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s.open])

  // 轮询运行中的任务。
  React.useEffect(() => {
    if (!s.open) return
    if (!s.jobs.some((j) => j.status === 'running')) {
      setPolling(false)
      return
    }
    setPolling(true)
    const t = window.setInterval(() => { void pollRunning() }, POLL_MS)
    return () => window.clearInterval(t)
  }, [s.open, s.jobs])

  if (!s.open) return null

  const rows: React.ReactElement[] = []
  for (const j of s.jobs.slice(0, 6)) {
    const card = React.createElement(JobCard, { key: j.jobId, job: j })
    rows.push(card)
  }

  return React.createElement('div', { className: 'imgdraw-popup', role: 'dialog', 'aria-label': '文生图' },
    React.createElement('div', { className: 'imgdraw-popup-head' },
      React.createElement('span', { className: 'imgdraw-popup-title' }, '🎨 文生图'),
      React.createElement('button', { type: 'button', className: 'imgdraw-mini', onClick: () => closePopup(), 'aria-label': '关闭' }, '✕'),
    ),
    React.createElement('div', { className: 'imgdraw-popup-body' },
      React.createElement('textarea', {
        className: 'imgdraw-textarea',
        placeholder: '描述你要生成的画面（中文/英文均可）…',
        value: s.prompt,
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setStore({ prompt: e.target.value }),
        rows: 4,
      }),
      React.createElement('div', { className: 'imgdraw-row' },
        React.createElement('button', {
          type: 'button',
          className: 'imgdraw-mini',
          onClick: () => setStore({ prompt: TEMPLATE_SIN_V10 }),
          title: '填入 Sin 头像 v10 定稿基础提示词',
        }, '🧑‍🎨 Sin v10 模板'),
        React.createElement('span', { className: 'imgdraw-muted' }, '基础模板一键填入'),
      ),
      React.createElement('div', { className: 'imgdraw-row' },
        React.createElement('label', { className: 'imgdraw-field' },
          '尺寸 ',
          React.createElement('select', {
            value: s.size,
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setStore({ size: e.target.value }),
          }, ...SIZES.map((sz) => React.createElement('option', { key: sz, value: sz }, sz))),
        ),
        React.createElement('label', { className: 'imgdraw-field' },
          '数量 ',
          React.createElement('select', {
            value: String(s.count),
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setStore({ count: Number(e.target.value) }),
          }, ...[1, 2, 4].map((n) => React.createElement('option', { key: n, value: String(n) }, `${n} 张`))),
        ),
        React.createElement('label', { className: 'imgdraw-field' },
          '后端 ',
          React.createElement('select', {
            value: s.backend,
            onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setStore({ backend: e.target.value }),
          }, ...(s.backends.length > 0
            ? s.backends.map((b) => React.createElement('option', { key: b.id, value: b.id }, b.label))
            : [React.createElement('option', { key: 'dashscope', value: 'dashscope' }, '百炼 wan2.7-image（免费）')])),
        ),
      ),
      React.createElement('div', { className: 'imgdraw-quota' },
        s.backends.map((b) => React.createElement('span', { key: b.id, className: 'imgdraw-quota-item' },
          `${b.label}：已用 ${b.quota} 次${b.keyPresent ? '' : '（未配置 key）'}`,
        )),
      ),
      s.error ? React.createElement('div', { className: 'imgdraw-err' }, s.error) : null,
      React.createElement('div', { className: 'imgdraw-actions' },
        React.createElement('button', {
          type: 'button',
          className: 'imgdraw-go',
          disabled: s.busy || polling,
          onClick: () => void submitGeneration(),
        }, s.busy || polling ? '生成中…' : '⚡ 生成'),
        React.createElement('button', { type: 'button', className: 'imgdraw-mini', onClick: () => setStore({ prompt: '' }) }, '清空'),
      ),
      rows.length > 0 ? React.createElement('div', { className: 'imgdraw-jobs' }, ...rows) : null,
      s.recent.length > 0 ? React.createElement('div', { className: 'imgdraw-recent' },
        React.createElement('div', { className: 'imgdraw-recent-head' }, '最近生成'),
        React.createElement('div', { className: 'imgdraw-grid' },
          ...s.recent.slice(0, 12).map((f) => React.createElement(
            'figure',
            { key: f.name, className: 'imgdraw-cell' },
            React.createElement('img', { src: f.url, alt: f.name, loading: 'lazy' }),
            React.createElement('figcaption', null,
              React.createElement('span', { className: 'imgdraw-fname', title: f.name }, f.name),
              React.createElement(FileActions, { file: f }),
            ),
          )),
        ),
      ) : null,
    ),
  )
}

// ---- styles ----------------------------------------------------------------

const CSS = `
.imgdraw-btn{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 8px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:6px;font-size:13px;line-height:1;cursor:pointer;user-select:none}
.imgdraw-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.imgdraw-btn:focus-visible{outline:2px solid var(--dsw-alias-state-primary);outline-offset:1px}
.imgdraw-popup{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);width:min(560px,calc(100vw - 32px));max-height:min(72vh,640px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-2,#fff));color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.3);z-index:120;font-size:13px}
.imgdraw-popup-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.imgdraw-popup-title{font-size:14px;font-weight:600}
.imgdraw-popup-body{padding:12px 14px;overflow-y:auto}
.imgdraw-textarea{width:100%;box-sizing:border-box;min-height:88px;resize:vertical;background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;font:inherit;line-height:1.6}
.imgdraw-textarea:focus{outline:2px solid var(--dsw-alias-state-primary);outline-offset:0}
.imgdraw-row{display:flex;align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap}
.imgdraw-field{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary)}
.imgdraw-field select{background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:4px 6px;font:inherit}
.imgdraw-quota{display:flex;flex-direction:column;gap:2px;margin-top:8px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.imgdraw-err{margin-top:8px;padding:8px 10px;border-radius:8px;color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);word-break:break-all}
.imgdraw-actions{display:flex;align-items:center;gap:10px;margin-top:12px}
.imgdraw-go{flex:1;padding:8px 0;border:0;border-radius:8px;background:var(--dsw-alias-state-primary,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-bg-overlay,#fff);font-size:14px;font-weight:600;cursor:pointer}
.imgdraw-go:disabled{opacity:.55;cursor:default}
.imgdraw-mini{padding:2px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer;text-decoration:none;display:inline-block}
.imgdraw-mini:hover{background:var(--dsw-alias-interactive-bg-hover)}
.imgdraw-mini:disabled{opacity:.5;cursor:default}
.imgdraw-kept{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 45%,transparent)}
.imgdraw-danger:hover{color:var(--dsw-alias-state-error-primary)}
.imgdraw-muted{color:var(--dsw-alias-label-tertiary);font-size:12px}
.imgdraw-job{margin-top:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px}
.imgdraw-running{opacity:.85}
.imgdraw-job-error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent)}
.imgdraw-job-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.imgdraw-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.imgdraw-cell{margin:0;display:flex;flex-direction:column;gap:6px}
.imgdraw-cell img{width:100%;height:auto;border-radius:8px;display:block;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}
.imgdraw-cell figcaption{display:flex;flex-direction:column;gap:4px}
.imgdraw-fname{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.imgdraw-file-actions{display:flex;gap:6px}
.imgdraw-jobs{display:flex;flex-direction:column;gap:2px}
.imgdraw-recent{margin-top:14px;border-top:1px solid var(--dsw-alias-border-l1);padding-top:10px}
.imgdraw-recent-head{font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:8px;font-weight:600}
`

/** Package id — must match package.json `name` and the ModuleLoader handoff. */
export const name = 'dsh-imgdraw'

/** Required client services. */
export const inject = ['slots']

/**
 * Inject the stylesheet the client-modules way: a `<style data-plugin=...>`
 * tag on document.head, idempotent across re-applies.
 */
function injectStyles(): void {
  if (typeof document === 'undefined') return
  const tagId = 'dsh-imgdraw/ui'
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = name
  tag.dataset.pluginCss = tagId
  tag.textContent = CSS
  document.head.appendChild(tag)
}

/** Client entry: register the button and the popup. */
export function apply(ctx: ClientContext): void {
  injectStyles()
  const slots = ctx.slots as unknown as {
    inject(key: string, callback: () => unknown): unknown
    register(opts: unknown, component: unknown): unknown
  }

  slots.inject('conversation.input.left', () => slots.register(
    { name: 'conversation.input.left', id: 'imgdraw', order: 0, label: '生图' } as never,
    (props: Record<string, unknown>) => React.createElement(DrawButton, props),
  ) as never)

  slots.inject('conversation.input.overlay', () => slots.register(
    { name: 'conversation.input.overlay', id: 'imgdraw-popup', order: 2 } as never,
    (props: Record<string, unknown>) => React.createElement(DrawPopup, props),
  ) as never)

  // 首次挂载时预热 backends/quota（供按钮打开时即时显示）。
  void rpc('backends').then((b) => setStore({ backends: b.backends ?? [] })).catch(() => { /* ignore */ })
}
