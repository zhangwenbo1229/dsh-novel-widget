/**
 * 挂件根组件：把「会话（业务时序）+ 现场（store）+ 视图」接起来。
 *
 * 三块各自的归属：
 * - `ReaderSession` 持有业务时序（取目录/取章/预取/存进度），**跨开合不重建**——
 *   用户关掉浮窗再打开还在原处。
 * - `state.ts` 的 store 持有交互现场（开合、几何、偏好、气泡位置），住模块级所以
 *   宿主面板切换导致的卸载不会丢。
 * - 本文件只做接线与副作用编排（读书架、恢复上次那本、开关时冲进度）。
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createApi, NovelApiError, type NovelApi } from '../api.js'
import { hoverZone, rectOf, rectOfElement, watchHoverExit } from '../hover.js'
import { widgetGeometry } from '../anchor.js'
import { useViewport } from '../viewport.js'
import { t } from '../copy.js'
import { clampGeometry } from '../prefs.js'
import { clampBubble } from '../snap.js'
import { ReaderSession, type ReaderSnapshot } from '../reader-session.js'
import {
  getLastBookKey,
  getState,
  setBubble,
  setGeometry,
  setLastBookKey,
  setOpen,
  subscribe,
} from '../state.js'
import type { ShelfEntry } from '../wire.js'
import { Bubble, openWidget } from './Bubble.js'
import { BookMenu } from './BookMenu.js'
import { Shell } from './Shell.js'
import { WidgetStyles } from '../styles.js'

/**
 * 书架的「够新」窗口（毫秒）：挂载、开窗、聚焦常在几十毫秒内接连触发，
 * 这段时间内只读一次就够。手动重读与「重新叫出挂件」不吃这个窗口。
 */
export const SHELF_FRESH_MS = 1500

/** 会话快照的订阅（ReaderSession 是普通订阅源，直接给 useSyncExternalStore 用） */
function useSessionSnapshot(session: ReaderSession): ReaderSnapshot {  return useSyncExternalStore(
    useCallback((fn: () => void) => session.subscribe(fn), [session]),
    () => session.getSnapshot(),
    () => session.getSnapshot(),
  )
}

export interface NovelWidgetProps {
  /** 注入点（测试用假 api；生产留空走页面 fetch） */
  api?: NovelApi
}

export function NovelWidget({ api }: NovelWidgetProps): ReactNode {
  const wiring = useMemo(() => api ?? createApi(), [api])
  const sessionRef = useRef<ReaderSession | null>(null)
  if (sessionRef.current === null) sessionRef.current = new ReaderSession({ api: wiring })
  const session = sessionRef.current
  const snapshot = useSessionSnapshot(session)

  const ui = useSyncExternalStore(subscribe, getState, getState)

  const [books, setBooks] = useState<ShelfEntry[]>([])
  const [booksLoading, setBooksLoading] = useState(false)
  const [booksError, setBooksError] = useState<string | null>(null)
  /** 右键菜单的落点（null = 没开） */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)

  /** 书架的「够新」窗口：挂载、开窗、聚焦常在几十毫秒内接连触发，只读一次就够 */
  const shelfInflight = useRef<Promise<void> | null>(null)
  const shelfFetchedAt = useRef(0)

  /**
   * 打开「该读的那本」：上次读的那本还在架就续它，否则取架上第一本。
   * 记录 bookKey 是为了下次仍能续上；`!` 有据——调用点都已确认 list 非空。
   */
  const openTarget = useCallback((list: ShelfEntry[]) => {
    if (list.length === 0) return
    const lastKey = getLastBookKey()
    const target = list.find((b) => b.bookKey === lastKey) ?? list[0]!
    setLastBookKey(target.bookKey)
    void session.open(target)
  }, [session])

  /**
   * 读书架 + **对账**。
   *
   * 为什么不能只在挂载时读一次（这是本轮修的核心）：删除书是在**另一个面板**里发生的，
   * 挂件与它不同子树、没有事件可听。旧实现只在挂载时读一次，于是删完之后挂件的书架
   * 永远停在旧快照上——更糟的是「自动打开」那条判断只在 `book === null` 时成立，
   * 被删掉的若是**正在读的那本**，会话还拿着这本已经不存在的书，既不会换书也不会回落，
   * 取章只会一路失败，而错误屏的「重试」又只是重读一遍书架、不对账，成了死循环。
   *
   * 现在这一处同时负责三件事：
   *   1. 读回新列表；
   *   2. **对账**：正在读的那本若已不在架上，清掉会话再接管（换一本；架上空了就回落选书屏）；
   *   3. 首次进入（还没选中任何书）时自动续上。
   * 「还在架上」时**什么都不做**——不打断正在读的位置，进度回写也不会被这次刷新搅乱。
   */
  const SHELF_TTL_MS = SHELF_FRESH_MS
  const refreshShelf = useCallback((opts: { force?: boolean } = {}): Promise<void> => {
    // 同一时刻只读一次：挂载、开窗、聚焦可能在几十毫秒内接连触发
    if (shelfInflight.current !== null) return shelfInflight.current
    if (opts.force !== true && Date.now() - shelfFetchedAt.current < SHELF_TTL_MS) {
      return Promise.resolve()
    }
    setBooksLoading(true)
    setBooksError(null)
    const task = wiring.shelf().then(async (list) => {
      shelfFetchedAt.current = Date.now()
      setBooks(list)
      setBooksLoading(false)
      const current = session.getSnapshot().book
      if (current === null) {
        openTarget(list)            // 还没选中任何书：续上上次那本
        return
      }
      if (list.some((b) => b.bookKey === current.bookKey)) return  // 仍在架：不动
      // 正在读的那本已被删除：清场（dispose 会顺手冲一次进度，失败也吞掉）
      await session.dispose()
      if (list.length > 0) openTarget(list)
      else setLastBookKey(null)     // 架上空了：别再指着那本已删的书
    }).catch((e: unknown) => {
      setBooksLoading(false)
      setBooks([])
      setBooksError(e instanceof NovelApiError
        ? (e.kind === 'unavailable' ? t('err.unavailable') : e.display)
        : t('err.generic', { msg: String(e) }))
    }).finally(() => { shelfInflight.current = null })
    shelfInflight.current = task
    return task
  }, [wiring, session, openTarget])

  // 挂载读一次
  useEffect(() => { void refreshShelf() }, [refreshShelf])

  /**
   * 每次把挂件叫出来都校验一次。
   * 删除发生在别的面板里，而挂件在鼠标移开时会自动缩回——所以「重新叫出来」正是
   * 用户删完书之后一定会经过的那一刻。force：这是用户动作，不吃 TTL。
   */
  const wasOpen = useRef(ui.open)
  useEffect(() => {
    if (ui.open && !wasOpen.current) void refreshShelf({ force: true })
    wasOpen.current = ui.open
  }, [ui.open, refreshShelf])

  /**
   * 回到本页（切窗口回来 / 标签页重新可见）也校验一次：覆盖「挂件一直开着，
   * 用户在另一个窗口或另一处删了书」这种情况。
   */
  useEffect(() => {
    const check = (): void => { if (getState().open) void refreshShelf() }
    const onVisible = (): void => { if (document.visibilityState === 'visible') check() }
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshShelf])

  /** 手动重读（「换一本」按钮与错误屏的「重试」）：强制，不吃 TTL */
  const reloadBooks = useCallback(() => { void refreshShelf({ force: true }) }, [refreshShelf])

  /**
   * 选中一本书：记下、打开、**关掉右键菜单**。
   * 关菜单这一步必须在这里：菜单项自己不管收场，否则换完书菜单还浮在屏幕上。
   */
  const pick = useCallback((book: ShelfEntry) => {
    setLastBookKey(book.bookKey)
    void session.open(book)
    setMenuAt(null)
  }, [session])

  /**
   * 视口变化：浮窗几何与气泡各夹回屏内。
   * 气泡只在**自由态**需要夹（吸附态每次渲染按边现算，见 snap.ts）；
   * 浮窗一律夹——否则换到小屏后它可能整个跑到屏幕外再也抓不到。
   */
  useEffect(() => {
    const onResize = (): void => {
      const vp = { width: window.innerWidth, height: window.innerHeight }
      const geo = getState().geometry
      const nextGeo = clampGeometry(geo, vp)
      if (nextGeo.x !== geo.x || nextGeo.y !== geo.y
        || nextGeo.width !== geo.width || nextGeo.height !== geo.height) {
        setGeometry(nextGeo)
      }
      const bub = getState().bubble
      if (bub.side !== null) return
      const nextBub = clampBubble(bub.x, bub.y, vp)
      if (nextBub.x !== bub.x || nextBub.y !== bub.y) setBubble({ ...nextBub, side: null })
    }
    onResize()
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [])

  /** 气泡点击 = 开关：开着就收起（收起前冲一次进度） */
  const onBubble = useCallback(() => {
    if (getState().open) {
      void session.flushProgress()
      setOpen(false)
      return
    }
    openWidget()
  }, [session])

  // ── 移出即缩回 ──────────────────────────────────────────────────────
  const viewport = useViewport()
  /**
   * 气泡与窗口的几何：**唯一推导**（`anchor.ts` 的 `widgetGeometry`）。
   * 窗口画在哪、移出判定用哪个框，都吃这一份。
   *
   * 这里曾经是「渲染后量 DOM 再报上来」：量到的是弹出动画进行中的框（`scale(.94)`，
   * 比真实小约 6%），而动画结束后没人重新量——安全区永远小一圈，指针落在窗口右侧/
   * 底部那条窄带里就被判成「已移出」，于是鼠标还没移开、窗口自己缩回去了。
   * 命中判定要的是元素最终占据的盒子，那个盒子本来就是算出来的，不该去量。
   */
  const geometry = widgetGeometry(ui.bubble, viewport)
  /**
   * 几何放一份 ref 给悬停监听读。
   * 为什么不把它写进 effect 依赖：`geometry` 每次渲染都是新对象，写进依赖会让监听
   * **每次渲染都拆掉重建**——那会顺带重置缩回计时，指针明明已经移开也可能一直不缩。
   * 监听只该在「开合 / 钉住」变化时重建。
   */
  const geometryRef = useRef(geometry)
  geometryRef.current = geometry

  /**
   * 窗口与气泡的真实 DOM。
   *
   * 命中判定要**量**它们，不能照 `widgetGeometry` 的数值推算：真实宿主的外壳祖先带
   * `transform`（合成层）时，它会成为 `position: fixed` 的包含块，窗口被画在
   * 「祖先偏移 + 我们给的值」处，而 `clientX/clientY` 是视口坐标——两者差一整个偏移，
   * 判定区整体错位，鼠标明明在窗口里却判成已移出。
   *
   * 这与「别去量 DOM」不矛盾：当初量错是因为**在缩放动画进行中量、之后不再量**。
   * 现在的口径是「在判定那一刻量」——量到的就是它与 `clientX/clientY` 同一坐标系的
   * 真实位置，既没有动画瞬态，也没有祖先偏移的假设。入场动画也已改成只做透明度，
   * 不再有 transform 让第一次量到的框失真。
   */
  const windowEl = useRef<HTMLElement | null>(null)
  const bubbleEl = useRef<HTMLElement | null>(null)
  const onWindowEl = useCallback((el: HTMLElement | null) => { windowEl.current = el }, [])
  const onBubbleEl = useCallback((el: HTMLElement | null) => { bubbleEl.current = el }, [])
  /**
   * 退场动画：`open` 变 false 时不立刻卸载，先播 140ms 的缩回，再真正移除。
   * 为什么值得：瞬间消失会让人怀疑「是不是我点错了」；一段短缩回把因果关系说明白。
   * `leaving` 是纯瞬时的视觉阶段，不落盘、不进 store。
   */
  const [leaving, setLeaving] = useState(false)
  const prevOpen = useRef(ui.open)
  useEffect(() => {
    if (prevOpen.current && !ui.open) {
      setLeaving(true)
      const t = window.setTimeout(() => setLeaving(false), 140)
      prevOpen.current = ui.open
      return () => { window.clearTimeout(t) }
    }
    prevOpen.current = ui.open
    return undefined
  }, [ui.open])
  /** 拖动气泡 / 打开抽屉期间不缩回 */
  const [pinned, setPinned] = useState(false)

  useEffect(() => {
    if (!ui.open) return
    return watchHoverExit({
      /**
       * 气泡与浮窗的并集：从气泡挪进窗口的路上不缩。
       * 两块的矩形都**现场量**（元素还没挂上时退回算出来的几何兜底）。
       */
      getZone: () => {
        const g = geometryRef.current
        const bub = bubbleEl.current
        const win = windowEl.current
        return hoverZone(
          bub === null ? g.bubble : rectOfElement(bub),
          win === null ? rectOf(g.window) : rectOfElement(win),
        )
      },
      isLocked: () => pinned,
      onExit: () => {
        // 缩回前把进度存一次：这正是「读到这里为止」的那个时机
        void session.flushProgress()
        setOpen(false)
      },
    })
  }, [ui.open, pinned, session])

  return (
    <>
      <WidgetStyles />
      <Bubble
        position={ui.bubble}
        reading={snapshot.book !== null}
        onOpen={onBubble}
        onElement={onBubbleEl}
        onContextMenu={(at: { x: number; y: number }) => setMenuAt(at)}
      />
      {menuAt !== null && (
        <BookMenu
          at={menuAt}
          books={books}
          currentKey={snapshot.book?.bookKey ?? null}
          onPick={pick}
          onClose={() => setMenuAt(null)}
        />
      )}
      {(ui.open || leaving) && (
        <Shell
          session={session}
          snapshot={snapshot}
          books={books}
          booksLoading={booksLoading}
          booksError={booksError}
          onReloadBooks={reloadBooks}
          onPick={pick}
          prefs={ui.prefs}
          placement={geometry.window}
          onElement={onWindowEl}
          onPinChange={setPinned}
          leaving={leaving}
        />
      )}
    </>
  )
}
