/**
 * 阅读面板：气泡里的正文区 + 底部功能键。
 *
 * 形态口径：只有一种阅读态——正文直接可滚动。打开就是连续正文，一屏装得下多少显示多少，
 * 其余滚动即得；滚动天然触发预取与进度回写。
 *
 * ── 落位：为什么不是「章一变就跳一下」那么简单 ──────────────────────────
 *
 * 跳章时（目录 / 上一章 / 下一章）要滚动到目标章的起点。这里的坑在于**目标章的内容
 * 往往还没到货**：跳过去的一瞬间整屏都是「正在取第 N 章…」占位，每章只有十几像素高，
 * 内容比容器还矮、根本没有可滚动空间，`scrollHeight - clientHeight` 是 0 —— 落位被夹成 0，
 * 等于没落。等真内容到达（实测 815 → 2572px 这种量级），布局完全变了，可此时
 * 没有任何事件再触发一次落位，用户就停在了错误的位置上（点第 21 章却看到第 19 章）。
 *
 * 所以落位是**追着布局跑**的：只要「还是同一次落位」且「用户没有自己滚过」，
 * 每次量到布局变化就补落一次，直到落点稳定。用户一旦自己滚动就立刻停手——
 * 追着布局补落是为了修正布局，不是为了跟用户抢滚动条。
 *
 * 三个量的口径：
 * - **锚点用实测起点**（`measureAnchors`），不用「各章高度累加」：章与章之间有 20px 外边距
 *   与分隔线，累加会每章差 20px，跳十几章就偏出半屏。
 * - **量高一律在布局阶段做**（`useLayoutEffect`），滚动回写放在下一帧（rAF）里，避免
 *   一边读一边写同一帧的布局。
 * - **量不出来就不动**：整屏占位时 `locateChapter` 返回 null，会话会保持原位置。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { t } from '../copy.js'
import { anchorTop, type ChapterAnchor } from '../progress.js'
import type { ReaderSession, ReaderSnapshot } from '../reader-session.js'

export interface ReaderPaneProps {
  session: ReaderSession
  snapshot: ReaderSnapshot
  /** 换一本：回选书屏（先把进度冲一次） */
  onSwitchBook: () => void
  onOpenToc: () => void
  onOpenPrefs: () => void
}

/** 章节正文：一段一段 <p>；空行渲染成矮空段，保留原文呼吸 */
function ChapterBody({ paragraphs }: { paragraphs: string[] }): ReactNode {
  return (
    <div className="dnw-prose">
      {paragraphs.map((line, i) => (
        line === ''
          ? <p key={i} className="dnw-blank" aria-hidden="true" />
          : <p key={i}>{line}</p>
      ))}
    </div>
  )
}

/** 落点是否「实质上」没变：章相同且比例差在 1% 以内 */
function samePlace(
  a: { chapterIndex: number; offsetRatio: number },
  b: { chapterIndex: number; offsetRatio: number },
): boolean {
  return a.chapterIndex === b.chapterIndex && Math.abs(a.offsetRatio - b.offsetRatio) < 0.01
}

/**
 * 目标章之前（含它自己）是否都已不再是「加载中」——落点是否已经由最终布局决定。
 *
 * 为什么只看**目标章之前**：目标章的顶端位置只由它前面那几章的高度决定，
 * 它自己与后面的章还在加载不影响落点。这样判据既准确又不必等整屏都取完。
 *
 * 为什么不用「连续两轮落点一致」：目标章若已经在窗口里（跳得近），跳转之后不会再有
 * 渲染，第二轮永远不来——协议就卡在「跳转中」，之后的滚动回写全被忽略。
 */
function settledBefore(first: number, target: number, slots: Map<number, { status: string }>): boolean {
  for (let i = first; i <= target; i += 1) {
    const slot = slots.get(i)
    if (slot === undefined || slot.status === 'loading') return false
  }
  return true
}

export function ReaderPane({ session, snapshot, onSwitchBook, onOpenToc, onOpenPrefs }: ReaderPaneProps): ReactNode {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const chapterRefs = useRef(new Map<number, HTMLElement>())
  const rafRef = useRef<number | null>(null)
  /**
   * 上一次落位：章、比例、以及**当时落到哪个像素**。
   * 第三个量用来判断「用户有没有自己滚过」——我们落的位被用户滚动覆盖后就该停手。
   */
  const landed = useRef<{ chapterIndex: number; offsetRatio: number; top: number } | null>(null)

  const { window: win, place, toc } = snapshot

  /**
   * 量出窗口内各章的真实锚点（起点 + 高度），都在**内容坐标系**里。
   *
   * 用相邻矩形的差算起点：`章顶 − (容器顶 − scrollTop)`，而不是 `offsetTop`。
   * 这样写有两个好处：不受祖先 transform 影响（两边一起平移，差值不变）；
   * 章与章之间的外边距、分隔线、内边距全都自动算进去，不会逐章累计漂移。
   */
  const measureAnchors = useCallback((): ChapterAnchor[] => {
    const el = scrollRef.current
    if (el === null) return []
    const containerTop = el.getBoundingClientRect().top
    const origin = containerTop - el.scrollTop
    const out: ChapterAnchor[] = []
    for (let i = win.first; i <= win.last; i += 1) {
      const node = chapterRefs.current.get(i)
      if (node === undefined) continue
      const r = node.getBoundingClientRect()
      out.push({ index: i, start: r.top - origin, height: r.height })
    }
    return out
  }, [win.first, win.last])

  /** 目标位置（该章的起点 + 章内比例）；量不出该章时给 null */
  const targetTop = useCallback((anchors: ChapterAnchor[], el: HTMLElement): number | null =>
    anchorTop(anchors, place.chapterIndex, place.offsetRatio, el.scrollHeight, el.clientHeight),
  [place.chapterIndex, place.offsetRatio])

  /** 滚动 → 回写位置 + 预取（放在下一帧：先让本帧的落位写完，再读一次布局） */
  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (el === null) return
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      session.reportScroll(el.scrollTop, measureAnchors())
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
      if (remaining < el.clientHeight * 1.5) void session.growTail()
    })
  }, [measureAnchors, session])

  useEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll) }
  }, [onScroll])

  /**
   * 落位（每次都跑，自己判断该不该动，见文件头注）。
   *
   * 两种模式：
   * - **跳转中**（`snapshot.jumping`）：目标章是刚点出来的，内容多半还没到货。
   *   此时**每一轮布局都补落一次**，直到「目标章之前那几章都不再是加载中」——那时候
   *   目标章的顶端位置才算定下来（它只由前面那几章的高度决定），于是 `endJump()` 交还控制权。
   *   这期间会话忽略滚动回写，所以目标章不会被改写。
   * - **平时**：只在目标位置变了（换章）时落一次；用户滚动自己产生的 `place` 变化，
   *   落点与当前像素本就一致，等于无操作。
   */
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    const anchors = measureAnchors()
    const top = targetTop(anchors, el)
    if (top === null) return // 目标章还没挂上 / 还量不出来：等下一次

    if (snapshot.jumping) {
      el.scrollTop = top
      landed.current = { chapterIndex: place.chapterIndex, offsetRatio: place.offsetRatio, top: el.scrollTop }
      // 目标章之前（含它自己）都不再是「加载中」⇒ 落点已经由最终布局决定
      if (settledBefore(win.first, place.chapterIndex, snapshot.slots)) {
        session.endJump()
        session.reportScroll(el.scrollTop, anchors)
      }
      return
    }

    const last = landed.current
    if (last !== null && samePlace(last, place) && Math.abs(el.scrollTop - last.top) <= 2) return
    el.scrollTop = top
    landed.current = { chapterIndex: place.chapterIndex, offsetRatio: place.offsetRatio, top: el.scrollTop }
    session.reportScroll(el.scrollTop, anchors)
  })

  /**
   * 用户自己滚动 ⇒ 立刻结束「跳转中」。
   *
   * 判据用**输入事件**（滚轮 / 触摸 / 按键）而不是「滚动位置变了」：补内容时浏览器会
   * 自己调整滚动偏移（滚动锚定），那也算位置变了，但那是浏览器在帮我们稳住画面，
   * 不是用户接管——把它误判成用户操作，正是上一版「停在错误章节再也不落位」的原因。
   */
  useEffect(() => {
    const el = scrollRef.current
    if (el === null) return
    const end = (): void => { session.endJump() }
    const opts: AddEventListenerOptions = { passive: true }
    el.addEventListener('wheel', end, opts)
    el.addEventListener('touchstart', end, opts)
    el.addEventListener('keydown', end)
    return () => {
      el.removeEventListener('wheel', end)
      el.removeEventListener('touchstart', end)
      el.removeEventListener('keydown', end)
    }
  }, [session])

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
  }, [])

  const chapters: ReactNode[] = []
  for (let i = win.first; i <= win.last; i += 1) {
    const slot = snapshot.slots.get(i)
    const title = toc[i]?.name ?? ''
    chapters.push(
      <section
        key={i}
        className="dnw-chapter"
        data-chapter={i}
        ref={(el) => {
          if (el === null) chapterRefs.current.delete(i)
          else chapterRefs.current.set(i, el)
        }}
      >
        <h2 className="dnw-chapter-title">{title}</h2>
        {slot === undefined || slot.status === 'loading'
          ? <div className="dnw-hint">{t('read.loading', { n: i + 1 })}</div>
          : slot.status === 'rich'
            ? <div className="dnw-hint dnw-state-error">{t('read.richUnsupported')}</div>
            : slot.status === 'failed'
              ? (
                <div className="dnw-hint">
                  <div className="dnw-state-error">{t('read.failed')}</div>
                  <button type="button" className="dnw-link" onClick={() => { void session.retryChapter(i) }}>
                    {t('read.retry')}
                  </button>
                </div>
              )
              : <ChapterBody paragraphs={slot.paragraphs} />}
      </section>,
    )
  }

  return (
    <>
      <div className="dnw-scroll" ref={scrollRef} tabIndex={0}>
        {chapters}
      </div>
      <div className="dnw-footer">
        <button type="button" className="dnw-btn" disabled={place.chapterIndex <= 0} onClick={() => { void session.prev() }}>
          {t('read.prev')}
        </button>
        <button type="button" className="dnw-btn" onClick={onOpenToc} aria-label={t('toc.title')}>
          {t('toc.title')}
        </button>
        <span className="dnw-footer-spacer">
          {t('read.chapterOf', { n: place.chapterIndex + 1, total: toc.length })}
        </span>
        <button type="button" className="dnw-btn" onClick={onOpenPrefs} aria-label={t('prefs.title')}>
          Aa
        </button>
        <button
          type="button"
          className="dnw-btn"
          disabled={toc.length > 0 && place.chapterIndex >= toc.length - 1}
          onClick={() => { void session.next() }}
        >
          {t('read.next')}
        </button>
        <button type="button" className="dnw-btn dnw-btn-quiet" onClick={onSwitchBook} title={t('pick.choose')}>
          {t('pick.choose')}
        </button>
      </div>
    </>
  )
}
