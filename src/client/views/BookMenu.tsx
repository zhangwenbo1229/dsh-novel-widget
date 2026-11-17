/**
 * 右键菜单：在气泡上右键换书。
 *
 * 为什么用右键而不是再加一个可见按钮：浮窗里的按钮已经够多了（上一章/目录/Aa/下一章/
 * 换一本），气泡本身又只有 44px。右键是「不占地方的第二个入口」——知道的人顺手就用，
 * 不知道的人也不会看到一个挤在小圆点旁边的图标。
 *
 * 三条实现纪律：
 * 1. **必须 `preventDefault`** 掉浏览器原生菜单，否则两层菜单会同时出现。
 * 2. **菜单自己也吃右键**：在菜单上再右键不该弹第二层，也不该把菜单关掉。
 * 3. **点外面 / Esc / 滚轮都收**：浮层菜单不收起是常见的埋雷点。
 *
 * 菜单内容只读本地已经拿到的那份书架快照（`books`），不在这里发请求——
 * 右键应当立刻出东西，不能等网络。
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '../copy.js'
import type { ShelfEntry } from '../wire.js'

export interface BookMenuProps {
  /** 菜单出现的位置（视口坐标，通常是右键落点） */
  at: { x: number; y: number }
  books: ShelfEntry[]
  /** 当前在读的 bookKey（打勾） */
  currentKey: string | null
  onPick: (book: ShelfEntry) => void
  onClose: () => void
}

/** 菜单最大高度：超出就自己滚（书多的用户不该看到一串跑到屏幕外的行） */
const MAX_HEIGHT = 320
/** 菜单与视口边缘的留白 */
const MARGIN = 8

export function BookMenu({ at, books, currentKey, onPick, onClose }: BookMenuProps): ReactNode {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState(at)

  /**
   * 夹回视口：右键点在屏幕右下角时，菜单默认会向右下展开并跑出屏幕。
   * 用实测尺寸算，而不是猜一个固定宽高——书名长短会改变宽度。
   */
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    const x = Math.min(at.x, Math.max(MARGIN, window.innerWidth - r.width - MARGIN))
    const y = Math.min(at.y, Math.max(MARGIN, window.innerHeight - r.height - MARGIN))
    if (x !== pos.x || y !== pos.y) setPos({ x, y })
  })

  // 点外面 / Esc / 滚轮 / 视口变化都收
  useEffect(() => {
    /**
     * 点外面关；点在菜单内部**必须直接放行**。
     * 不能「先关再让它点」：菜单一卸载，按钮随之消失，click 根本不会到达，
     * 表现为「点了没反应」。所以判据要落在 pointerdown 的落点上，而不是事后补救。
     */
    const onDown = (e: PointerEvent): void => {
      const el = ref.current
      if (el !== null && e.target instanceof Node && el.contains(e.target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    const onAny = (): void => onClose()
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('wheel', onAny, { passive: true, capture: true })
    window.addEventListener('resize', onAny)
    window.addEventListener('blur', onAny)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('wheel', onAny, true)
      window.removeEventListener('resize', onAny)
      window.removeEventListener('blur', onAny)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="dnw-root dnw-menu"
      role="menu"
      aria-label={t('menu.title')}
      style={{ left: pos.x, top: pos.y, maxHeight: MAX_HEIGHT }}
      // 菜单上的右键：既不吃掉也不外泄（否则会弹浏览器原生菜单）
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
      onPointerDown={(e) => { e.stopPropagation() }}
    >
      <div className="dnw-menu-title">{t('menu.title')}</div>
      <div className="dnw-menu-list">
        {books.length === 0
          ? <div className="dnw-menu-empty">{t('pick.empty.title')}</div>
          : books.map((b) => (
            <button
              key={b.bookKey}
              type="button"
              role="menuitemradio"
              aria-checked={b.bookKey === currentKey}
              className="dnw-menu-item"
              onClick={() => onPick(b)}
              title={b.title}
            >
              <span className="dnw-menu-check" aria-hidden="true">{b.bookKey === currentKey ? '✓' : ''}</span>
              <span className="dnw-menu-label">{b.title}</span>
              {b.author !== undefined && b.author !== '' && (
                <span className="dnw-menu-sub">{b.author}</span>
              )}
            </button>
          ))}
      </div>
    </div>
  )
}
