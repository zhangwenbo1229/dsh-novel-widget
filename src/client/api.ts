/**
 * dsh-novel 的 HTTP 客户端（浏览器半）：四个读口 + 一个写口。
 *
 * 三条口径：
 * 1. **同源相对 fetch**：路由前缀由 `wire.ts` 的单点持有，本文件不拼 host —— 挂件跑在
 *    宿主页面上，`/novel-api` 天然同源，dsh-novel 的同源 fence 不需要任何额外配置。
 * 2. **信封解包只此一处**：`{ ok, value | error }` 的判别、HTTP 状态与 error.code 的合并
 *    全在 `request()`；调用方拿到的是值或一个已分类的 `NovelApiError`，不自己读 body。
 * 3. **错误分类不猜**：`unavailable`（对面插件没装/路由不存在）与 `failed`（业务失败）分开——
 *    前者要出「请先安装 dsh-novel」的指引，后者是「这一章没抓下来，重试」。把两者折叠成
 *    「都失败了」会让用户永远找不到真正的原因。
 */

import {
  type ApiEnvelope,
  type BookDetail,
  type ChapterContent,
  type ChapterEntry,
  type ShelfEntry,
  patchBody,
  progressBody,
  routes,
} from './wire.js'

/** 失败的两个大divergence：对面不可达 vs 对面答了但答的是失败 */
export type NovelErrorKind = 'unavailable' | 'failed'

export class NovelApiError extends Error {
  readonly kind: NovelErrorKind
  readonly code: string
  /** 对用户的那句话（已分类，可直接上屏） */
  readonly display: string

  constructor(kind: NovelErrorKind, code: string, message: string, display: string) {
    super(message)
    this.name = 'NovelApiError'
    this.kind = kind
    this.code = code
    this.display = display
  }
}

/** 可注入的 fetch（测试用假容器；生产恒为页面自带的全局 fetch） */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface ApiDeps {
  fetch?: FetchLike
  /** 读口超时：目录与正文都可能走真站点抓取，给足 */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

function unavailable(message: string): NovelApiError {
  return new NovelApiError('unavailable', 'Unavailable', message, '未连上小说插件')
}

function failed(code: string, message: string): NovelApiError {
  return new NovelApiError('failed', code, message, message === '' ? '请求失败' : message)
}

/** 一次请求的完整语义：超时、非 JSON、信封失败、网络断——各自归类，不互相冒充 */
async function request<T>(fetchImpl: FetchLike, path: string, init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetchImpl(path, { ...init, signal: controller.signal })
  } catch (e) {
    // 网络层失败与超时：都算「对面这次没答话」，但不是「对面没装」——后者由 HTTP 状态判
    const aborted = e instanceof Error && e.name === 'AbortError'
    throw failed(aborted ? 'Timeout' : 'Network', aborted ? '请求超时' : `网络请求失败：${String(e)}`)
  } finally {
    clearTimeout(timer)
  }

  // 404 且不是 dsh-novel 的信封：前缀路由根本不在 ⇒ 插件没装或没启用
  let body: unknown
  try {
    body = await res.json()
  } catch {
    throw res.status === 404
      ? unavailable(`GET ${path} → 404（/novel-api 不存在）`)
      : failed('BadResponse', `响应不是 JSON（HTTP ${res.status}）`)
  }

  const env = body as ApiEnvelope<T>
  if (env !== null && typeof env === 'object' && typeof env.ok === 'boolean') {
    if (env.ok) return env.value as T
    const err = env.error
    throw failed(err?.code ?? 'Unknown', err?.message ?? '')
  }
  throw failed('BadEnvelope', `响应不是统一信封（HTTP ${res.status}）`)
}

export interface NovelApi {
  shelf(): Promise<ShelfEntry[]>
  toc(sourceId: string, bookKey: string, refresh?: boolean): Promise<ChapterEntry[]>
  chapter(sourceId: string, bookKey: string, index: number, refresh?: boolean): Promise<ChapterContent>
  book(sourceId: string, bookKey: string): Promise<BookDetail>
  /** 存进度：不在架的书写回会 400（dsh-novel 的门面动词判据），本挂件据此提示而不重试 */
  saveProgress(bookKey: string, chapterIndex: number, offsetRatio: number): Promise<ShelfEntry>
  /** 补书目元数据（只发要改的键，其余保值）。刷新目录后把新的章数同步回书架。 */
  patchMeta(bookKey: string, patch: { totalChapters?: number }): Promise<ShelfEntry>
}

/** 生产实现（页面自带 fetch 与默认超时） */
export function createApi(deps: ApiDeps = {}): NovelApi {
  const fetchImpl: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init))
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const get = <T>(path: string): Promise<T> => request<T>(fetchImpl, path, undefined, timeoutMs)
  return {
    shelf: () => get<ShelfEntry[]>(routes.shelf()),
    toc: async (sourceId, bookKey, refresh) => {
      // toc 的读面只给线性章表；navigation 是另一条形状，这里不带兜底——见 wire.ts 的注释
      const list = await get<ChapterEntry[]>(routes.toc(sourceId, bookKey, refresh))
      return Array.isArray(list) ? list : []
    },
    chapter: (sourceId, bookKey, index, refresh) =>
      get<ChapterContent>(routes.chapter(sourceId, bookKey, index, refresh)),
    book: (sourceId, bookKey) => get<BookDetail>(routes.book(sourceId, bookKey)),
    saveProgress: (bookKey, chapterIndex, offsetRatio) =>
      request<ShelfEntry>(fetchImpl, routes.shelfKey(bookKey), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(progressBody(chapterIndex, offsetRatio)),
      }, timeoutMs),
    patchMeta: (bookKey, patch) =>
      request<ShelfEntry>(fetchImpl, routes.shelfKey(bookKey), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patchBody(patch)),
      }, timeoutMs),
  }
}
