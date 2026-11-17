/**
 * 浮窗外壳：**锚定在气泡旁的消息气泡**。
 *
 * 形态口径（本轮定型）：
 * - **没有标题栏**。书名 / 章号 / 折叠 / 关闭那一整条都撤了——用户要的是「像一条消息
 *   那样弹出来」，顶着一排控件就不像消息了。因此也**没有「拖到别处」**这个动作：
 *   位置唯一主人是 `anchor.ts`（气泡 + 视口现算），气泡往哪挪它就跟到哪。
 *   关掉它有三条路：鼠标移出（`hover.ts` 的自动缩回）、Esc、底部「换一本」。
 * - 窗口里直接是正文，默认就能滚完整章；底部一行功能键。
 * - 背景是纯白（`--dnw-paper`），不跟宿主的表面色走：气泡是「一张纸」，
 *   深色主题下也读白纸，这与主面板的阅读区口径一致。
 *
 * 生命周期纪律：
 * - **关窗时冲进度**：Esc / 移出自动缩回，都调 `session.flushProgress()`。
 * - **失焦时冲进度**：`window` 的 blur 说明用户去干别的了，此刻的位置就是下次该回来的位置。
 * - **关窗不卸载会话**：会话留着（下次打开还是这本、这个位置），只有换书才 `dispose`。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Placement } from '../anchor.js'
import { t } from '../copy.js'
import type { Prefs } from '../prefs.js'
import type { ReaderSession, ReaderSnapshot } from '../reader-session.js'
import { setOpen, setPrefs } from '../state.js'
import type { ShelfEntry } from '../wire.js'
import { BookPicker } from './BookPicker.js'
import { PrefsBar } from './PrefsBar.js'
import { ReaderPane } from './ReaderPane.js'
import { TocDrawer } from './TocDrawer.js'

export interface ShellProps {
  session: ReaderSession
  snapshot: ReaderSnapshot
  books: ShelfEntry[]
  booksLoading: boolean
  booksError: string | null
  onReloadBooks: () => void
  onPick: (book: ShelfEntry) => void
  prefs: Prefs
  /** 浮窗位置（由父层用 widgetGeometry 算好；父层还要用同一份做移出判定） */
  placement: Placement
  /** 「此刻别缩回」的开关：打开抽屉 / 改设置期间为 true */
  onPinChange: (pinned: boolean) => void
  /** 把窗口元素交给父层：移出判定要量它真正在屏幕上的位置（见 hover.ts 的 rectOfElement） */
  onElement?: (el: HTMLDivElement | null) => void
  /** 正在播退场动画（此时窗口已逻辑关闭，只差卸载） */
  leaving?: boolean
}

type Drawer = 'none' | 'toc' | 'prefs'

export function Shell(props: ShellProps): ReactNode {
  const { session, snapshot, prefs } = props
  const [drawer, setDrawer] = useState<Drawer>('none')
  const rootRef = useRef<HTMLDivElement | null>(null)

  // 位置由父层给（唯一推导 anchor.ts 的 widgetGeometry）：父层要用同一份做移出判定，
  // 在这里再算一次就是第二份抄本，迟早与判定用的那个框错开。
  const placed = props.placement

  // ── 关闭 / Esc / 失焦：冲一次进度 ───────────────────────────────────
  const close = useCallback(() => {
    void session.flushProgress()
    setOpen(false)
    setDrawer('none')
  }, [session])

  useEffect(() => {
    const onBlur = (): void => { void session.flushProgress() }
    window.addEventListener('blur', onBlur)
    return () => { window.removeEventListener('blur', onBlur) }
  }, [session])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (drawer !== 'none') { setDrawer('none'); e.stopPropagation(); return }
      close()
    }
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true) }
  }, [drawer, close])

  const onPick = useCallback((book: ShelfEntry) => {
    props.onPick(book)
    setDrawer('none')
  }, [props])

  /**
   * 刷新目录：把会话的结果翻成一句话交给抽屉显示。
   * 翻译归这里（视图层），会话只回事实（新增几章 / 为什么没成）——
   * 会话不认识文案，它连 `t` 都只在错误口径上用。
   */
  const reloadToc = useCallback(async (): Promise<string> => {
    const r = await session.reloadToc()
    if (!r.ok) return r.message
    const parts: string[] = []
    if (r.added > 0) parts.push(t('toc.refresh.added', { n: r.added }))
    else if (r.added === 0) parts.push(t('toc.refresh.none'))
    else parts.push(t('toc.refresh.ok', { n: r.total }))
    if (r.added < 0) parts.push(t('toc.refresh.ok', { n: r.total }))
    if (r.moved) parts.push(t('toc.refresh.moved'))
    return parts.join(' · ')
  }, [session])

  const currentChapter = snapshot.place.chapterIndex

  /**
   * 换书之后把滚动条送回顶部。
   * 阅读会话自己会把窗口与位置重置，但**滚动容器是视图自己的状态**：换到另一本书时
   * 它保留着上一本的 scrollTop，于是新书一打开就停在中段。
   */
  const bookKey = snapshot.book?.bookKey ?? null
  useLayoutEffect(() => {
    const el = rootRef.current?.querySelector('.dnw-scroll')
    if (el instanceof HTMLElement) el.scrollTop = 0
  }, [bookKey])

  // 抽屉打开时钉住：用户正在目录里找章，指针可能移到窗口外去看，不能缩回。
  // 依赖写 `props.onPinChange` 而不是 `props`：后者每次渲染都是新对象，effect 会在
  // 每次渲染后重跑一遍——同一类写法此前把矩形清理挂在 `[props]` 上，每次重渲染都把
  // 安全区清成 null，正是「还没移开就缩回」的成因之一。
  useLayoutEffect(() => {
    props.onPinChange(drawer !== 'none')
  }, [drawer, props.onPinChange])

  return (
    <div
      ref={(el) => {
        rootRef.current = el
        props.onElement?.(el)
      }}
      className={props.leaving === true ? 'dnw-root dnw-window is-leaving' : 'dnw-root dnw-window'}
      data-side={placed.side}
      style={{
        left: placed.x,
        top: placed.y,
        width: placed.width,
        height: placed.height,
        ['--dnw-arrow-x' as string]: `${placed.arrowX}px`,
        // 字号/行距/栏宽经 CSS 变量下发：正文与章名共用同一份，改一处全变
        ['--dnw-font' as string]: `${prefs.fontPx}px`,
        ['--dnw-line' as string]: String(prefs.lineHeight),
        ['--dnw-measure' as string]: String(prefs.measureEm),
      }}
      role="dialog"
      aria-modal="false"
      aria-label={snapshot.book === null ? t('shell.title') : snapshot.book.title}
    >
      {/* 指向气泡的尖角：位置由 --dnw-arrow-x 给，朝向由 data-side 翻 */}
      <span className="dnw-arrow" aria-hidden="true" />

      <div className="dnw-body">
        {snapshot.book === null || snapshot.phase === 'idle'
          ? (
            <BookPicker
              books={props.books}
              loading={props.booksLoading}
              error={props.booksError}
              onPick={onPick}
              onRetry={props.onReloadBooks}
              currentKey={snapshot.book?.bookKey ?? null}
            />
          )
          : snapshot.phase === 'error'
            ? (
              <div className="dnw-state">
                <div className="dnw-state-title dnw-state-error">{t('read.failed')}</div>
                <div className="dnw-state-hint">{snapshot.error?.message ?? ''}</div>
                <button type="button" className="dnw-ghost" onClick={props.onReloadBooks}>
                  {t('read.retry')}
                </button>
              </div>
            )
            : snapshot.phase === 'loadingBook'
              ? <div className="dnw-state">{t('pick.loading')}</div>
              : (
                <ReaderPane
                  session={session}
                  snapshot={snapshot}
                  onSwitchBook={() => { void session.flushProgress(); props.onReloadBooks() }}
                  onOpenToc={() => setDrawer('toc')}
                  onOpenPrefs={() => setDrawer('prefs')}
                />
              )}

        {drawer === 'toc' && (
          <TocDrawer
            toc={snapshot.toc}
            current={currentChapter}
            order={prefs.tocDescending ? 'desc' : 'asc'}
            onToggleOrder={() => setPrefs({ tocDescending: !prefs.tocDescending })}
            onRefresh={reloadToc}
            onJump={(i) => { setDrawer('none'); void session.jumpTo(i) }}
            onClose={() => setDrawer('none')}
          />
        )}
        {drawer === 'prefs' && (
          <PrefsBar
            prefs={prefs}
            onChange={(patch) => setPrefs(patch)}
            onClose={() => setDrawer('none')}
          />
        )}
      </div>
    </div>
  )
}
