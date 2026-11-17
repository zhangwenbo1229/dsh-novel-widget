/**
 * 目录抽屉：跳章 + 当前章高亮 + 正序/倒序切换。
 *
 * 为什么必须虚拟化：真实书源动辄 700–3000 章（本机那本 713 章）。一次渲染全部按钮
 * 在 400px 宽的浮窗里会生成几千个 DOM 节点，打开抽屉要卡半秒。
 *
 * 手法是最朴素的定高虚拟滚动：固定 32px 行高 → 滚动位置直接换算可见区间 →
 * 上垫一块 `start*ROW` 高的空 div、下垫剩余高度。行高必须与 CSS 的 32px 严格一致，
 * 否则滚动条会在滚动过程中跳。
 *
 * **两级下标别混**（本文件最容易搞错的地方）：
 * - `chapter`：书内章号，**阅读语义**（进度、取章、上一章/下一章都按它）
 * - `display`：列表里的第几行，**陈列语义**（正序时两者相同，倒序时互为镜像）
 * 所有虚拟滚动的位置换算都发生在 display 空间，只有渲染某一行时才映射回 chapter。
 *
 * 顺序偏好不住在本组件：它是**阅读偏好**（`prefs.tocDescending`），与字号行距一样
 * 本机记住、下次打开还是那个顺序。本组件只管按给定顺序陈列。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { t } from '../copy.js'
import type { ChapterEntry } from '../wire.js'

/** 行高（px）：与 `.dnw-toc-item` 的 padding + line-height 之和一致 */
const ROW = 32
/** 视口上下各多渲染几行，滚动时不露白 */
const OVERSCAN = 6

/** 陈列顺序：`asc` 第 1 章在前（缺省），`desc` 最新章在前 */
export type TocOrder = 'asc' | 'desc'

export interface TocDrawerProps {
  toc: ChapterEntry[]
  /** 当前读到的章号（书内章号，不是列表行号） */
  current: number
  /** 陈列顺序（住 prefs，本组件不自己存） */
  order: TocOrder
  onToggleOrder: () => void
  /** 去源站重取目录；返回一句给用户看的结果（调用方负责发请求） */
  onRefresh: () => Promise<string>
  onJump: (chapterIndex: number) => void
  onClose: () => void
}

/** 陈列行号 → 书内章号 */
export function displayToChapter(display: number, total: number, order: TocOrder): number {
  return order === 'asc' ? display : total - 1 - display
}

/** 书内章号 → 陈列行号 */
export function chapterToDisplay(chapter: number, total: number, order: TocOrder): number {
  return order === 'asc' ? chapter : total - 1 - chapter
}

export function TocDrawer({ toc, current, order, onToggleOrder, onRefresh, onJump, onClose }: TocDrawerProps): ReactNode {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(360)
  /** 刷新中（按钮禁用 + 文案变化）；结果一句话留在头部，几秒后自己消失 */
  const [refreshing, setRefreshing] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const noteTimer = useRef<number | null>(null)
  /**
   * 切换顺序之后要落在哪。
   *
   * - `null`（打开抽屉 / 换章）：当前章居中——第一眼就该看到「我读到哪」
   * - `'head'`：落在新顺序的开头
   * - `{ chapter }`：把这一章放回视口顶部
   */
  const pendingAnchor = useRef<null | 'head' | { chapter: number }>(null)

  const total = toc.length

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    const anchor = pendingAnchor.current
    pendingAnchor.current = null
    const top = anchor === null
      ? chapterToDisplay(current, total, order) * ROW - el.clientHeight / 2 + ROW / 2
      : anchor === 'head'
        ? 0
        : chapterToDisplay(anchor.chapter, total, order) * ROW
    el.scrollTop = Math.max(0, top)
    setScrollTop(el.scrollTop)
  }, [current, order, total])

  // 视口高度会随浮窗缩放变（ResizeObserver 在窄窄容器上比 window resize 准）
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    const ro = new ResizeObserver(() => setViewport(el.clientHeight))
    ro.observe(el)
    setViewport(el.clientHeight)
    return () => { ro.disconnect() }
  }, [])

  /**
   * 切换顺序：决定切完落在哪。
   *
   * 两条规则，针对两类真实用法：
   * 1. **列表首行就在顶部** ⇒ 用户还没浏览过（刚打开抽屉、当前章靠前时就是这个位置）。
   *    此时没有「正在看的位置」可保，直接落在新顺序的开头——否则会撞上下面的边界：
   *    第 1 章在倒序里是最后一行，「保住它在顶部」只能滚到列表底部，看起来像跳错了。
   * 2. **已经滚到中间某处** ⇒ 把视口顶部那一章放回顶部。用户可能正翻着找某一章，
   *    切个顺序不该把他弹回当前章。
   */
  const toggleOrder = useCallback(() => {
    const el = scrollRef.current
    if (el !== null && total > 0) {
      const topDisplay = Math.min(total - 1, Math.max(0, Math.floor(el.scrollTop / ROW)))
      pendingAnchor.current = topDisplay === 0
        ? 'head'
        : { chapter: displayToChapter(topDisplay, total, order) }
    }
    onToggleOrder()
  }, [onToggleOrder, order, total])

  // 虚拟窗口在 **display 空间** 里算
  const start = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN)
  const end = Math.min(total, Math.ceil((scrollTop + viewport) / ROW) + OVERSCAN)

  const rows = useMemo(() => {
    const out: ReactNode[] = []
    for (let d = start; d < end; d += 1) {
      const chapter = displayToChapter(d, total, order)
      const entry = toc[chapter]
      if (entry === undefined) continue
      out.push(
        <button
          key={chapter}          // key 用章号：切顺序时同一章仍是同一个元素，高亮不会闪
          type="button"
          className="dnw-toc-item"
          data-current={chapter === current ? 'true' : 'false'}
          style={{ height: ROW }}
          aria-current={chapter === current ? 'true' : undefined}
          onClick={() => onJump(chapter)}
          title={entry.name}
        >
          {entry.name === '' ? `${t('unit.chapter')} ${chapter + 1}` : entry.name}
        </button>,
      )
    }
    return out
  }, [start, end, toc, current, order, total, onJump])

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop((e.target as HTMLDivElement).scrollTop)
  }, [])

  /**
   * 刷新目录：去源站重取（可能耗时数秒）。
   *
   * 组件只负责「按钮状态 + 把结果说给人听」，取数与对账都在会话里——那里才知道
   * 当前读的是哪一章、缓存该不该作废。刷新期间按钮禁用，避免连点打出一串请求。
   */
  const refresh = useCallback(() => {
    if (refreshing) return
    setRefreshing(true)
    setNote(null)
    if (noteTimer.current !== null) window.clearTimeout(noteTimer.current)
    void onRefresh().then((message) => {
      setRefreshing(false)
      setNote(message)
      // 结果自己退场：它是「刚才那一下」的回执，不是常驻状态
      noteTimer.current = window.setTimeout(() => setNote(null), 6000)
    }).catch((e: unknown) => {
      setRefreshing(false)
      setNote(String(e))
    })
  }, [onRefresh, refreshing])

  useEffect(() => () => {
    if (noteTimer.current !== null) window.clearTimeout(noteTimer.current)
  }, [])

  return (
    <div className="dnw-drawer" role="dialog" aria-modal="false" aria-label={t('toc.title')}>
      <div className="dnw-drawer-head">
        <span className="dnw-drawer-title">{t('toc.title')}</span>
        <span className="dnw-drawer-count">{t('toc.count', { n: total })}</span>
        {/* 右上角三颗：刷新 / 顺序 / 关闭 */}
        <button
          type="button"
          className="dnw-btn dnw-toc-refresh"
          onClick={refresh}
          disabled={refreshing}
          title={t('toc.refresh.hint')}
          aria-label={t('toc.refresh')}
          aria-busy={refreshing ? 'true' : undefined}
        >
          {refreshing ? t('toc.refresh.running') : t('toc.refresh')}
        </button>
        {total > 1 && (
          <button
            type="button"
            className="dnw-btn dnw-toc-order"
            onClick={toggleOrder}
            // 按钮上写**当前**顺序，title 说清点了会变成什么——写「将要变成的」会让人
            // 误以为当前已是那个顺序
            title={t(order === 'asc' ? 'toc.order.toDesc' : 'toc.order.toAsc')}
            aria-label={t('toc.order.toggle')}
            aria-pressed={order === 'desc'}
          >
            {t(order === 'asc' ? 'toc.order.asc' : 'toc.order.desc')}
          </button>
        )}
        <button type="button" className="dnw-btn" onClick={onClose} aria-label={t('toc.close')}>✕</button>
      </div>
      {note !== null && <div className="dnw-drawer-note" role="status">{note}</div>}
      <div className="dnw-toc" ref={scrollRef} onScroll={onScroll} tabIndex={0}>
        {total === 0
          ? <div className="dnw-state">{t('toc.empty')}</div>
          : (
            <div className="dnw-toc-spacer" style={{ height: total * ROW }}>
              <div style={{ transform: `translateY(${start * ROW}px)` }}>{rows}</div>
            </div>
          )}
      </div>
    </div>
  )
}
