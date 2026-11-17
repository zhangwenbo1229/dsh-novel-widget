/**
 * 阅读会话：一本书从「打开」到「读到哪」的全部动作（React 之外）。
 *
 * 为什么不做成组件 state：这是**业务时序**（取目录 → 取章 → 预取 → 存进度），
 * 与「这一刻画什么样」是两件事。塞进组件的后果是每次卸载都丢现场、每个事件处理器都要
 * 自己判「现在是不是还在跑同一本书」。这里用一份显式会话状态 + 单调的 generation 号，
 * 过期的异步返回一律丢弃（`gen` 变了 = 用户换书了，老请求的结果不许落进来）。
 *
 * 状态机（`phase`）：
 *   idle → loadingBook（读书架/目录） → reading
 *   任何一步失败 → error（可重试，重试回到出错的那一步）
 *
 * 依赖全部注入（`ReaderDeps`），所以测试能塞假 api、假时钟，不必起宿主。
 */

import { NovelApiError, type NovelApi } from './api.js'
import { t } from './copy.js'
import {
  buildAnchors,
  locateChapter,
  samePlace,
  type ChapterAnchor,
} from './progress.js'
import {
  extendTail,
  initialWindow,
  trimWindow,
  windowFor,
  type Window,
} from './reader-model.js'
import type { ChapterEntry, ShelfEntry } from './wire.js'

/** 错误 → 给用户看的一句话。三处（打开失败 / 取章失败 / 刷新目录失败）共用一份，
 *  省得每处各判一次 `kind` 而判出三种口径。 */
function messageOf(e: unknown): string {
  if (e instanceof NovelApiError) {
    return e.kind === 'unavailable' ? t('err.unavailable') : e.display
  }
  return t('err.generic', { msg: String(e) })
}

/** 刷新目录的结果：成功给章数账目，失败给人话 */
export type TocReloadResult =
  | { ok: true; total: number; added: number; moved: boolean }
  | { ok: false; message: string }

/** 一屏之内的一章：正文已取到（kind text）或取失败 */
export type ChapterSlot =
  | { status: 'loading' }
  | { status: 'ready'; title: string; paragraphs: string[] }
  | { status: 'rich' }
  | { status: 'failed'; message: string }

export interface ReaderSnapshot {
  phase: 'idle' | 'loadingBook' | 'reading' | 'error'
  /** 当前这本书（null = 还没选书） */
  book: ShelfEntry | null
  toc: ChapterEntry[]
  window: Window
  /** 章号 → 该章在窗口内的内容 */
  slots: Map<number, ChapterSlot>
  /** 当前章（滚动的归属）与章内比例 */
  place: { chapterIndex: number; offsetRatio: number }
  /** 锚点表（本章窗口内各章的实测位置）；视图测完高度回写 */
  anchors: ChapterAnchor[]
  error: { message: string; kind: NovelApiError['kind'] | 'unknown' } | null
  /** 正在进行的动作（视图据此禁按钮 / 显加载态） */
  busy: boolean
  /**
   * **跳转尚未落定**：目标章是刚点出来的，内容多半还没到货（整屏「加载中」占位）。
   *
   * 为什么要有这个显式状态，而不是靠滚动位置推断：跳转瞬间的布局（每章十几像素的占位）
   * 与真内容（上千像素）差着两个数量级，此时任何「按实测位置反过来推算当前章」都会算错，
   * 而且会**把用户点的目标章覆盖掉**（实测就是「点第 21 章 → 被改写成第 18 章」，
   * 之后上一章/下一章都在错误位置上继续漂）。
   * 所以：落定之前，滚动回写一律不作数；视图负责追着布局补落，
   * 落点连续两轮一致（或用户自己动了滚轮）就由 `endJump()` 收尾。
   */
  jumping: boolean
}

export interface ReaderDeps {
  api: NovelApi
  /** 存进度（生产是 api.saveProgress；测试可观察调用） */
  saveProgress?: (bookKey: string, chapterIndex: number, offsetRatio: number) => Promise<unknown>
  /** 渲染层把纯文字切成段落；默认真实实现，测试可塞定值 */
  paragraphsOf?: (text: string) => string[]
}

/** 正文 → 段落的缺省实现（与 reader-model 的 toParagraphs 一致的语义，注入点分离便于单测） */
import { toParagraphs } from './reader-model.js'

function emptySnapshot(): ReaderSnapshot {
  return {
    phase: 'idle',
    book: null,
    toc: [],
    window: { first: 0, last: -1 },
    slots: new Map(),
    place: { chapterIndex: 0, offsetRatio: 0 },
    anchors: [],
    error: null,
    busy: false,
    jumping: false,
  }
}

/**
 * 会话对象。视图持有它、订阅它；所有写动作都经它的方法。
 *
 * 单点纪律：
 * - `gen` 是**唯一的**「这还是不是同一本书」判据：每个异步回来先比它。
 * - `place` 只由 `setPlace`（滚动回写）与 `jumpTo`（跳章）改，别处不直接写。
 * - 进度写盘只在 `flushProgress` 一处，且它自己按 `samePlace` 去抖。
 */
export class ReaderSession {
  private state: ReaderSnapshot = emptySnapshot()
  private gen = 0
  private listeners = new Set<() => void>()
  private lastSaved: { chapterIndex: number; offsetRatio: number } | null = null
  /** 已发起取章的章号（防重复请求；失败的要删掉才允许重试） */
  private inflight = new Set<number>()
  private readonly deps: ReaderDeps
  private readonly paragraphsOf: (text: string) => string[]

  constructor(deps: ReaderDeps) {
    this.deps = deps
    this.paragraphsOf = deps.paragraphsOf ?? toParagraphs
  }

  getSnapshot(): ReaderSnapshot {
    return this.state
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private emit(patch: Partial<ReaderSnapshot>): void {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  private fail(e: unknown, gen: number): void {
    if (gen !== this.gen) return
    const kind = e instanceof NovelApiError ? e.kind : 'unknown'
    this.emit({ phase: 'error', error: { message: messageOf(e), kind }, busy: false })
  }

  // ── 打开一本书 ──────────────────────────────────────────────────────

  /**
   * 打开一本书：取目录 → 按存档进度定窗口 → 取当前章。
   * `startAt` 缺省用书架里的 `progress.chapterIndex`。
   */
  async open(book: ShelfEntry, startAt?: number): Promise<void> {
    const gen = ++this.gen
    this.inflight.clear()
    this.lastSaved = null
    this.emit({
      phase: 'loadingBook',
      book,
      toc: [],
      window: { first: 0, last: -1 },
      slots: new Map(),
      anchors: [],
      error: null,
      busy: true,
      place: { chapterIndex: startAt ?? book.progress.chapterIndex, offsetRatio: 0 },
    })

    let toc: ChapterEntry[]
    try {
      toc = await this.deps.api.toc(book.sourceId, book.bookKey)
    } catch (e) {
      this.fail(e, gen)
      return
    }
    if (gen !== this.gen) return
    if (toc.length === 0) {
      this.emit({ phase: 'error', error: { message: t('toc.empty'), kind: 'unknown' }, busy: false })
      return
    }

    const total = toc.length
    const chapterIndex = Math.min(total - 1, Math.max(0, startAt ?? book.progress.chapterIndex))
    const window = initialWindow(chapterIndex, total)
    this.emit({
      phase: 'reading',
      toc,
      window,
      busy: false,
      place: {
        chapterIndex,
        offsetRatio: startAt === undefined ? Math.min(1, Math.max(0, book.progress.offsetRatio)) : 0,
      },
      // 恢复进度也是一次跳转：内容还没到货，落位同样要等布局定下来
      jumping: true,
    })
    await this.fillWindow(gen)
  }

  /** 把窗口内缺的章都取回来（并发，但每章只发一次） */
  private async fillWindow(gen: number): Promise<void> {
    const st = this.state
    const { first, last } = st.window
    const jobs: Promise<void>[] = []
    for (let i = first; i <= last; i += 1) {
      if (st.slots.has(i) || this.inflight.has(i)) continue
      jobs.push(this.loadChapter(i, gen))
    }
    if (jobs.length > 0) await Promise.all(jobs)
  }

  private async loadChapter(index: number, gen: number): Promise<void> {
    const st = this.state
    const book = st.book
    if (book === null) return
    if (index < 0 || index >= st.toc.length) return
    this.inflight.add(index)
    this.setSlot(index, { status: 'loading' })
    try {
      const content = await this.deps.api.chapter(book.sourceId, book.bookKey, index)
      if (gen !== this.gen) return
      if (content.kind === 'rich') {
        this.setSlot(index, { status: 'rich' })
        return
      }
      const title = st.toc[index]?.name ?? ''
      this.setSlot(index, { status: 'ready', title, paragraphs: this.paragraphsOf(content.text) })
    } catch (e) {
      if (gen !== this.gen) return
      this.setSlot(index, { status: 'failed', message: messageOf(e) })
    } finally {
      this.inflight.delete(index)
    }
  }

  private setSlot(index: number, slot: ChapterSlot): void {
    // Map 原地改会让 useSyncExternalStore 拿到同一引用 ⇒ 视图不重渲。复制一份是必须的。
    const slots = new Map(this.state.slots)
    slots.set(index, slot)
    this.emit({ slots })
  }

  /** 某章失败后点重试：删掉失败槽再取一次 */
  async retryChapter(index: number): Promise<void> {
    const slot = this.state.slots.get(index)
    if (slot === undefined || slot.status !== 'failed') return
    const gen = this.gen
    const slots = new Map(this.state.slots)
    slots.delete(index)
    this.emit({ slots })
    await this.loadChapter(index, gen)
  }

  // ── 刷新目录（源站更新了书籍）──────────────────────────────────────

  /**
   * 去源站重取目录（`?refresh=1`，绕过缓存），让挂件跟上源站新增的章节。
   *
   * 三条口径（每条都对应一处会出错的细节）：
   *
   * 1. **当前读的那一章按 URL 认，不按下标认**。源站补章有两种：末尾追加（下标不变）
   *    和中间插入（其后所有下标 +1）。按下标认，第二种情况会把读者甩到别的章上；
   *    按 `url` 认（章节地址是它在源站上的身份）才是稳的。认不出来时退回夹取后的原下标。
   * 2. **旧的正文本缓存全部作废**。缓存的键是下标，而插章会让下标与正文错位——
   *    继续用旧缓存就会「目录是新的、正文是旧的且串位」。宁可全部重取。
   * 3. **空目录不作为结果**。源站偶尔会返回空表；拿它替换手里那份可用的目录，
   *    等于把一本能读的书变成读不了。空表一律当失败处理，保留原目录。
   *
   * 成功时顺手把新章数补回书架（一个字段的补丁），这样主面板的读数也跟着更新；
   * 这一步是尽力而为，失败不影响本次刷新结果。
   */
  async reloadToc(): Promise<TocReloadResult> {
    const st = this.state
    const book = st.book
    if (book === null || st.toc.length === 0) return { ok: false, message: t('toc.refresh.noBook') }
    const gen = this.gen
    // 先记下「读者现在在哪一章」——按 URL 认身份
    const currentUrl = st.toc[st.place.chapterIndex]?.url ?? null

    let fresh: ChapterEntry[]
    try {
      fresh = await this.deps.api.toc(book.sourceId, book.bookKey, true)
    } catch (e) {
      return { ok: false, message: messageOf(e) }
    }
    if (gen !== this.gen) return { ok: false, message: t('toc.refresh.cancelled') }
    if (fresh.length === 0) return { ok: false, message: t('toc.refresh.empty') }

    const before = st.toc.length
    // 认章：优先按 URL；URL 也对不上（源站换了域名/地址格式）就按原下标夹取
    const found = currentUrl === null ? -1 : fresh.findIndex((c) => c.url === currentUrl)
    const chapterIndex = found >= 0
      ? found
      : Math.min(fresh.length - 1, Math.max(0, st.place.chapterIndex))

    this.emit({
      toc: fresh,
      // 正文本缓存按下标存，插章后全部错位：清空重取（见本函数头注第 2 条）
      slots: new Map(),
      place: { chapterIndex, offsetRatio: st.place.offsetRatio },
      window: windowFor(chapterIndex, fresh.length, st.window),
      anchors: [],
      // 目录变了 ⇒ 布局会变，落位照跳转处理（会话会忽略这期间的滚动回写）
      jumping: true,
    })
    await this.fillWindow(gen)
    // 尽力同步书架上的章数（失败不影响本次刷新）
    void this.deps.api.patchMeta(book.bookKey, { totalChapters: fresh.length }).catch(() => {})

    // 读者原来那一章还在不在：按 URL 找不到时要说清楚，别让人以为还停在原处
    return {
      ok: true,
      total: fresh.length,
      added: fresh.length - before,
      moved: currentUrl !== null && found < 0,
    }
  }

  // ── 跳到某章 ────────────────────────────────────────────────────────

  async jumpTo(chapterIndex: number): Promise<void> {
    const st = this.state
    if (st.book === null || st.toc.length === 0) return
    const index = Math.min(st.toc.length - 1, Math.max(0, chapterIndex))
    const gen = this.gen
    const window = windowFor(index, st.toc.length, st.window)
    this.emit({ place: { chapterIndex: index, offsetRatio: 0 }, window, anchors: [], jumping: true })
    await this.fillWindow(gen)
    // 跳章是关键时机：跳完就存（不等滚动）
    await this.flushProgress(index, 0)
  }

  /** 下一章（到底 → 返回 false，由视图说「已经是最后一章」） */
  async next(): Promise<boolean> {
    const st = this.state
    const at = st.place.chapterIndex
    if (at >= st.toc.length - 1) return false
    await this.jumpTo(at + 1)
    return true
  }

  async prev(): Promise<boolean> {
    const at = this.state.place.chapterIndex
    if (at <= 0) return false
    await this.jumpTo(at - 1)
    return true
  }

  /** 滚动到底时扩窗口（预取）。返回是否有新内容（视图据此决定还要不要继续滚）。 */
  async growTail(): Promise<boolean> {
    const st = this.state
    if (st.book === null) return false
    const next = extendTail(st.window, st.toc.length)
    if (next === st.window) return false
    this.emit({ window: next })
    await this.fillWindow(this.gen)
    return true
  }

  // ── 滚动回写 ────────────────────────────────────────────────────────

  /**
   * 视口滚动后回写：算当前章与比例，必要时裁窗口。
   *
   * 入参是**实测锚点**（每章的起点与高度，由视图用 `getBoundingClientRect` 量出来），
   * 不是「把各章高度累加」的理想化结果：章与章之间有 20px 外边距、还有分隔线与内边距，
   * 累计起来每章差 20px——跳个十几章就偏出半屏。实测起点没有这个漂移。
   *
   * 量不出来时（整屏都还是「加载中」占位）`locateChapter` 会返回 null，此时**保持原位置**
   * 不动。这条很关键：跳转刚发生时正是这种布局，若在这里"猜一个"，用户点的目标章会被
   * 改写成窗口里的某一章。
   */
  reportScroll(scrollTop: number, anchors: ChapterAnchor[]): void {
    const st = this.state
    if (st.book === null || st.window.last < st.window.first) return
    // 跳转还没落定：此时的实测位置不可信（整屏占位 / 浏览器在补内容时自己调了偏移），
    // 拿它反推当前章会覆盖掉用户点的目标章。让视图去落位，落定了再回写。
    if (st.jumping) return
    const place = locateChapter(anchors, scrollTop)
    if (place === null) return
    if (place.chapterIndex === st.place.chapterIndex && place.offsetRatio === st.place.offsetRatio) return

    const trimmed = trimWindow(st.window, place.chapterIndex, st.toc.length)
    if (trimmed.dropped.length > 0) {
      const slots = new Map(st.slots)
      for (const i of trimmed.dropped) slots.delete(i)
      this.emit({ place, anchors, window: trimmed.window, slots })
      return
    }
    this.emit({ place, anchors })
  }

  /**
   * 落定：跳转的目标位置已经在屏幕上稳定（由视图判定）或用户自己接管了滚动。
   * 调用后滚动回写恢复正常。
   */
  endJump(): void {
    if (!this.state.jumping) return
    this.emit({ jumping: false })
  }

  /** 回读锚点供视图落位（换章 / 恢复进度时用） */
  anchors(): ChapterAnchor[] {
    return this.state.anchors
  }

  // ── 存进度（关键时机）────────────────────────────────────────────────

  /**
   * 存进度：只在三个关键时机调用——切章、浮窗失焦收起、挂件关闭。
   * 不轮询、不随滚动高频写（主面板与挂件可能同时读同一本书，高频互写会把位置来回拉扯）。
   */
  async flushProgress(chapterIndex?: number, offsetRatio?: number): Promise<void> {
    const st = this.state
    const book = st.book
    if (book === null) return
    const next = {
      chapterIndex: chapterIndex ?? st.place.chapterIndex,
      offsetRatio: offsetRatio ?? st.place.offsetRatio,
    }
    const clamped = { chapterIndex: next.chapterIndex, offsetRatio: Math.min(1, Math.max(0, next.offsetRatio)) }
    if (this.lastSaved !== null && samePlace(this.lastSaved, clamped)) return
    this.lastSaved = clamped
    const save = this.deps.saveProgress ?? ((k, i, r) => this.deps.api.saveProgress(k, i, r))
    try {
      await save(book.bookKey, clamped.chapterIndex, clamped.offsetRatio)
    } catch {
      // 存不上不打断阅读，但要把 lastSaved 放回去，让下一次还有机会写成功
      this.lastSaved = null
    }
  }

  /** 换书 / 关闭：先冲一次进度再清场 */
  async dispose(): Promise<void> {
    await this.flushProgress()
    this.gen += 1
    this.inflight.clear()
    this.state = emptySnapshot()
    for (const l of this.listeners) l()
  }
}
