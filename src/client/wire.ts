/**
 * dsh-novel 的 HTTP 契约镜像（**只镜像本挂件真正消费的那几格**）。
 *
 * 为什么镜像而不是 import：dsh-novel 的 `src/shared/wire.ts` 不是包导出面的一部分，
 * 且它的 client bundle 由它自己的纯度门打包——跨插件值 import 会被两边的构建期
 * 纯度门拒绝（见 dsh-novel 的 `tsdown.config.ts` 的 `dsh-novel-bundle-purity`）。
 * 跨插件协作只许走「运行时契约」（此处即 HTTP + JSON 形状），所以形状在这里抄一份。
 *
 * 抄本会不会腐烂：`tests/contract.test.ts` 在 `DSH_NOVEL_CONTRACT=1` 时真打本机
 * `/novel-api` 逐条比对形状与取值，dsh-novel 改契约那里立刻红。默认集不联网，
 * 因此常规 `pnpm test` 只证明镜像自洽（不证明对面没变）——这是刻意的分工。
 *
 * 本文件零运行时依赖：只有类型与常量，可被 client bundle 随意 inline。
 */

/** `/novel-api` 前缀（与 dsh-novel 的 `NOVEL_API_PREFIX` 一字不差） */
export const NOVEL_API_PREFIX = '/novel-api'

/** 本挂件消费的路由段（只列用到的；少列一条不影响，多列一条就是无主抄本） */
export const SEG = {
  shelf: 'shelf',
  toc: 'toc',
  chapter: 'chapter',
  navigation: 'navigation',
  book: 'book',
} as const

/** query 参数名（与 dsh-novel 的 `PARAMS` 同名同义） */
export const PARAMS = {
  sourceId: 'sourceId',
  /** bookKey 在 wire 上叫 `url`——历史口径，别按语义改名 */
  url: 'url',
  index: 'index',
  refresh: 'refresh',
} as const

/** 统一信封：成功 `{ ok: true, value }`，失败 `{ ok: false, error }` */
export interface ApiEnvelope<T> {
  ok: boolean
  value?: T
  error?: ApiErrorBody
}

export interface ApiErrorBody {
  code: string
  message: string
  /** 规则引擎错误的段级定位（本挂件不展示，原样透传用于日志） */
  segment?: { facet: string; segmentIndex: number; segmentRaw: string }
}

/** 阅读进度（与 dsh-novel 的 `ShelfProgress` 同形） */
export interface ShelfProgress {
  chapterIndex: number
  offsetRatio: number
  updatedAt: number
}

/** 书架条目（读取面：落盘字段 + 服务端投影的 `sourceName`） */
export interface ShelfEntry {
  sourceId: string
  /** 书身份（在线书是详情页 URL，本地书是 `local:<uuid>`）——它是 PUT 路径里的那个 key */
  bookKey: string
  title: string
  author?: string
  coverUrl?: string
  intro?: string
  lastChapterName?: string
  kind?: string
  wordCount?: string
  totalChapters?: number
  progress: ShelfProgress
  addedAt: number
  /** 来源投影：源已删 → null，本地书恒 null（本挂件只读，不据此判任何业务） */
  sourceName: string | null
}

/** 目录条目：`url` 是章节地址，数组下标即 `chapterIndex` */
export interface ChapterEntry {
  name: string
  url: string
}

/** 目录导航读面（本挂件只用线性 `chapters`；`items` 展示树留给主面板） */
export interface BookNavigation {
  chapters: ChapterEntry[]
  items: unknown[]
}

/** 章节正文：本挂件只支持 `kind: 'text'`（图文面 `rich` 是 v1 明确排除的范围） */
export type ChapterContent =
  | { kind: 'text'; text: string }
  | { kind: 'rich'; documentId: string; nodes: unknown[] }

/** 书籍详情（本挂件只用封面与简介做选书面板，其余字段不消费） */
export interface BookDetail {
  title?: string
  author?: string
  coverUrl?: string
  intro?: string
  [k: string]: unknown
}

// ── 路由构造（浏览器半唯一出口）──────────────────────────────────────────

function encodeQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  }
  return parts.join('&')
}

export const routes = {
  /** 书架全量（本挂件启动时读一次，决定读哪本） */
  shelf: (): string => `${NOVEL_API_PREFIX}/${SEG.shelf}`,
  /** 目录（按书）：线性章表 */
  toc: (sourceId: string, url: string, refresh?: boolean): string =>
    `${NOVEL_API_PREFIX}/${SEG.toc}?${encodeQuery({
      [PARAMS.sourceId]: sourceId,
      [PARAMS.url]: url,
      [PARAMS.refresh]: refresh === true ? '1' : undefined,
    })}`,
  /** 逐章正文 */
  chapter: (sourceId: string, url: string, index: number, refresh?: boolean): string =>
    `${NOVEL_API_PREFIX}/${SEG.chapter}?${encodeQuery({
      [PARAMS.sourceId]: sourceId,
      [PARAMS.url]: url,
      [PARAMS.index]: index,
      [PARAMS.refresh]: refresh === true ? '1' : undefined,
    })}`,
  /** 目录导航（本挂件不用；保留给契约测试核对两面对同一本书给同一份线性表） */
  navigation: (sourceId: string, url: string): string =>
    `${NOVEL_API_PREFIX}/${SEG.navigation}?${encodeQuery({ [PARAMS.sourceId]: sourceId, [PARAMS.url]: url })}`,
  /** 书籍详情 */
  book: (sourceId: string, url: string): string =>
    `${NOVEL_API_PREFIX}/${SEG.book}?${encodeQuery({ [PARAMS.sourceId]: sourceId, [PARAMS.url]: url })}`,
  /** 存进度（PUT）：bookKey 必须整段编码（它含 `://`，本地书还含 `:`） */
  shelfKey: (bookKey: string): string => `${NOVEL_API_PREFIX}/${SEG.shelf}/${encodeURIComponent(bookKey)}`,
}

/** `PUT shelf/:key` 的进度形态 body（与 dsh-novel 的 `bodies.shelfProgress` 同形） */
export function progressBody(chapterIndex: number, offsetRatio: number): Record<string, unknown> {
  return { progress: { chapterIndex, offsetRatio } }
}

/** `PUT shelf/:key` 的补丁形态 body（与 dsh-novel 的 `bodies.shelfPatch` 同形）。
 *  缺席的键保值——只发要改的那几个字段，不必重发书名作者那些。 */
export function patchBody(patch: { totalChapters?: number }): Record<string, unknown> {
  return { patch: { ...patch } }
}
