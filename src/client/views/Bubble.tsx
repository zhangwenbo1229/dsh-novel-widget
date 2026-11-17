/**
 * 常驻气泡：挂件的唯一入口。
 *
 * 行为三条：
 * 1. **可拖动**：`pointerdown` 起步 → `setPointerCapture` → 累计位移 → `pointerup`。
 *    位移小于 4px 才算点击（否则每次挪位置都会顺带打开浮窗）。
 * 2. **松手吸附**：离某条边 40px 以内就贴上去（`snap.ts` 的 `snapOnRelease`），
 *    四条边都远就留在原地。存的是「贴哪条边」这个语义，不是像素——所以换窗口大小时
 *    仍贴着边，而不是停在旧视口的像素上。
 * 3. **吸附态半透明**：贴边后降到 0.42，「让开」底下的界面；悬停 / 键盘聚焦回到 1，
 *    否则用户点不准一个半透明的圆点。自由态恒为 1。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '../copy.js'
import {
  bubbleOpacity,
  clampBubble,
  resolveBubble,
  snapOnRelease,
  type BubblePos,
} from '../snap.js'
import { setBubble, setOpen } from '../state.js'
import {
  WHALE_BELLY,
  WHALE_BODY,
  WHALE_DISC,
  WHALE_EYE,
  WHALE_GLYPH_VIEWBOX,
  WHALE_STALK_PATH,
  WHALE_TAIL_PATH,
} from '../whale-glyph.js'

/** 拖动阈值：小于它算点击 */
const DRAG_THRESHOLD = 4

export interface BubbleProps {
  /** 持久化的气泡位置（含吸附语义） */
  position: BubblePos
  /** 是否有在读的书（有则显一个小绿点） */
  reading: boolean
  onOpen: () => void
  /** 右键：在落点处打开换书菜单 */
  onContextMenu?: (at: { x: number; y: number }) => void
  /** 把气泡元素交给父层：移出判定要量它真正在屏幕上的位置 */
  onElement?: (el: HTMLButtonElement | null) => void
}

export function Bubble({ position, reading, onOpen, onContextMenu, onElement }: BubbleProps): ReactNode {
  const [dragging, setDragging] = useState(false)
  const [hovering, setHovering] = useState(false)
  /**
   * **键盘焦点**（不是「聚焦」）。两者必须分开：鼠标点一下按钮也会让它获得焦点，
   * 若把那种也算进来，拖完一放气泡就永远停在 opacity:1 ——吸附态的半透明再也回不来。
   * 只有 Tab 走过来的焦点（`:focus-visible`）才该把它点亮。
   */
  const [keyboardFocused, setKeyboardFocused] = useState(false)
  /** 拖动期间的临时位置（屏幕上跟手）；松手才写 store */
  const [live, setLive] = useState<{ x: number; y: number } | null>(null)
  const startRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const movedRef = useRef(false)

  // 落屏位置：拖动中跟手，否则按吸附语义现算（换窗口大小会自动贴回边）
  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const placed = live ?? resolveBubble(position, viewport)
  const opacity = bubbleOpacity(position.side, hovering || keyboardFocused)

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    startRef.current = { px: e.clientX, py: e.clientY, ox: placed.x, oy: placed.y }
    movedRef.current = false
    setDragging(true)
  }, [placed.x, placed.y])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const start = startRef.current
    if (start === null) return
    const dx = e.clientX - start.px
    const dy = e.clientY - start.py
    if (!movedRef.current && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return
    movedRef.current = true
    setLive(clampBubble(start.ox + dx, start.oy + dy, viewport))
  }, [viewport.width, viewport.height])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const start = startRef.current
    if (start === null) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    startRef.current = null
    setDragging(false)

    if (!movedRef.current) {
      setLive(null)
      onOpen()
      return
    }
    // 松手才决定吸附：跟手期间吸附会让气泡在指针下面「跳」
    const at = live ?? placed
    setBubble(snapOnRelease(at.x, at.y, viewport))
    setLive(null)
  }, [live, placed, onOpen, viewport.width, viewport.height])

  // 视口变化：自由态夹回屏内（吸附态由 resolveBubble 现算，无需处理）
  useEffect(() => {
    const onResize = (): void => {
      if (position.side !== null) return
      const at = clampBubble(position.x, position.y, viewport)
      if (at.x !== position.x || at.y !== position.y) setBubble({ ...at, side: null })
    }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [position.x, position.y, position.side, viewport.width, viewport.height])

  return (
    <button
      ref={onElement}
      type="button"
      className="dnw-root dnw-bubble"
      style={{ left: placed.x, top: placed.y, opacity }}
      data-dragging={dragging ? 'true' : 'false'}
      data-snapped={position.side !== null ? 'true' : 'false'}
      data-side={position.side ?? 'free'}
      aria-label={t('bubble.open')}
      title={t('bubble.open')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onFocus={(e) => setKeyboardFocused(e.currentTarget.matches(':focus-visible'))}
      onBlur={() => setKeyboardFocused(false)}
      onContextMenu={(e) => {
        // 挡掉浏览器原生菜单：不挡会看到两层菜单叠在一起
        e.preventDefault()
        onContextMenu?.({ x: e.clientX, y: e.clientY })
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() }
      }}
    >
      <WhaleGlyph />
      {reading && <span className="dnw-bubble-dot" aria-hidden="true" />}
    </button>
  )
}

/** 气泡上的鲸鱼字形：与 icon.svg 同一造型，只是压成 32×32 的紧凑版。
 *  用 SVG 而不是一个字：用户要求「挂件换成这个图标」，字与图标是两种东西；
 *  矢量也保证 44px 与 2x 屏上都清楚。 */
function WhaleGlyph(): ReactNode {
  // 与 icon.svg 同一造型：墨色圆底 + 白鲸身 + 尾鳍 + 挖出的腹部月牙与眼睛。
  // 用基本几何拼（圆 + 小扇形），不用一条复杂轮廓——缩到 30px 仍然认得出，
  // 也不会像手描路径那样越界被裁。
  const ink = "#1a1a1a"
  return (
    <svg
      className="dnw-bubble-glyph"
      viewBox={WHALE_GLYPH_VIEWBOX}
      width="30"
      height="30"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx={WHALE_DISC.cx} cy={WHALE_DISC.cy} r={WHALE_DISC.r} fill={ink} />
      <path d={WHALE_TAIL_PATH} fill="#ffffff" />
      <path d={WHALE_STALK_PATH} fill="#ffffff" />
      <circle cx={WHALE_BODY.cx} cy={WHALE_BODY.cy} r={WHALE_BODY.r} fill="#ffffff" />
      <circle cx={WHALE_BELLY.cx} cy={WHALE_BELLY.cy} r={WHALE_BELLY.r} fill={ink} />
      <circle cx={WHALE_EYE.cx} cy={WHALE_EYE.cy} r={WHALE_EYE.r} fill={ink} />
    </svg>
  )
}

/** 打开浮窗的统一动作（气泡点击与状态恢复共用） */
export function openWidget(): void {
  setOpen(true)
}
