/**
 * 浮窗相对气泡的锚定位置（纯函数）。
 *
 * 形态是**对话气泡**：气泡是头像，浮窗是它「说」出来的那句话——所以浮窗必须长在气泡
 * 旁边，且带一个指向气泡的尖角。位置不是自由坐标，而是每次按「气泡在哪 + 视口多大」
 * 现算出来的，这样：
 * - 气泡被拖到任何角落、吸附到任何一边，浮窗都跟着走；
 * - 窗口变窄变矮，浮窗自己缩，不会跑到屏幕外。
 *
 * 摆放次序（与聊天软件的弹出层同一条直觉）：
 * 1. 优先摆在气泡**下方**——阅读窗向下生长最自然；
 * 2. 下方装不下（贴着底边）就翻到**上方**；
 * 3. 两边都装不下就取空间大的那边，并把高度压到装得下的程度（不硬撑出屏幕）。
 *
 * 尖角始终指着气泡中心：窗口被视口夹回来之后，`arrowX` 会重算，所以尖角不会指歪。
 */

import { BUBBLE_SIZE, resolveBubble, type BubblePos } from './snap.js'

/** 气泡与浮窗之间的缝（尖角就长在这段缝里） */
export const ANCHOR_GAP = 10
/** 浮窗距视口边缘的最小留白 */
export const VIEWPORT_MARGIN = 8
/** 浮窗理想尺寸；实际按可用空间缩。
 *  高度刻意压到 280px（约 8–10 行正文）：它是「消息气泡」，扫一眼就该看完；
 *  拉高成阅读器就变成另一个界面了。 */
export const PREFERRED_WIDTH = 380
export const PREFERRED_HEIGHT = 280
/** 再挤也要留这么高，否则一个气泡里只剩两行字，没法读 */
export const MIN_VISIBLE_HEIGHT = 160
/** 尖角离窗口圆角的最近距离（太小会被圆角吃掉） */
const ARROW_INSET = 22

export type AnchorSide = 'below' | 'above'

export interface Placement {
  x: number
  y: number
  width: number
  height: number
  /** 尖角中心相对窗口左边的偏移 */
  arrowX: number
  /** 浮窗长在气泡的哪一侧 */
  side: AnchorSide
}

export interface Viewport { width: number; height: number }

export function placeWindow(
  bubble: { x: number; y: number },
  viewport: Viewport,
  preferred: { width?: number; height?: number } = {},
): Placement {
  const margin = VIEWPORT_MARGIN
  const width = Math.max(
    200,
    Math.min(preferred.width ?? PREFERRED_WIDTH, viewport.width - margin * 2),
  )
  const wantHeight = preferred.height ?? PREFERRED_HEIGHT

  const topEdge = bubble.y + BUBBLE_SIZE + ANCHOR_GAP
  const spaceBelow = viewport.height - margin - topEdge
  const spaceAbove = bubble.y - ANCHOR_GAP - margin

  // 下方能放下「够读的最低高度」就优先下方；否则翻到上方；两边都不行取更大的那侧
  let side: AnchorSide
  if (spaceBelow >= MIN_VISIBLE_HEIGHT) side = 'below'
  else if (spaceAbove >= MIN_VISIBLE_HEIGHT) side = 'above'
  else side = spaceBelow >= spaceAbove ? 'below' : 'above'

  const available = side === 'below' ? spaceBelow : spaceAbove
  const height = Math.max(MIN_VISIBLE_HEIGHT, Math.min(wantHeight, available))

  // 竖向：贴气泡那一侧固定距离，另一侧夹回视口（height 已按可用空间收过，
  // 只有「两边都不够」时才可能夹，此时表现为整个窗口贴住一边）
  const rawY = side === 'below' ? topEdge : bubble.y - ANCHOR_GAP - height
  const y = Math.min(Math.max(margin, rawY), Math.max(margin, viewport.height - height - margin))

  // 横向：让气泡中心落在离窗口左边 ARROW_INSET+ 的位置（尖角在左上），再夹回视口
  const centerX = bubble.x + BUBBLE_SIZE / 2
  const rawX = centerX - ARROW_INSET
  const x = Math.min(Math.max(margin, rawX), Math.max(margin, viewport.width - width - margin))

  // 尖角跟着气泡中心走；窗口被夹动之后重算，所以永远指着气泡
  const arrowX = Math.min(Math.max(ARROW_INSET, centerX - x), width - ARROW_INSET)

  return { x, y, width, height, arrowX, side }
}
/**
 * 气泡与窗口的**唯一几何推导**：气泡画在哪、窗口因此锚在哪。
 *
 * 为什么必须有这个函数（而不是各消费点自己算）：移出即缩回的「安全区」必须与
 * 真正画出来的那个框逐像素一致。旧做法是渲染后读 `getBoundingClientRect()` 报上来，
 * 结果量到的是**弹出动画进行中**的框（`scale(.94)`，比真实小约 6%），而动画结束后
 * 没人重新量——安全区永远小一圈，指针落在窗口右侧/底部那条窄带里就被判成「已移出」，
 * 于是「鼠标还没移开，窗口自己缩回去了」。
 *
 * 另一个理由：DOM 矩形带 transform（动画、缩放），对**命中判定**而言那恰恰是错的；
 * 判定要的是元素最终占据的盒子，而那个盒子就是 placeWindow 算出来的这四个数。
 *
 * 气泡位置取 `resolveBubble` 之后的值：吸附态下持久化的 x/y 只是「上次自由态的位置」，
 * 真正画出来的位置按当前视口现算。窗口据此锚定，才不会与气泡错位。
 */
export interface WidgetGeometry {
  /** 气泡实际占据的屏幕矩形 */
  bubble: { left: number; top: number; right: number; bottom: number }
  /** 窗口位置（含指向气泡的尖角偏移） */
  window: Placement
}

export function widgetGeometry(bubble: BubblePos, viewport: Viewport): WidgetGeometry {
  const at = resolveBubble(bubble, viewport)
  const win = placeWindow(at, viewport)
  return {
    bubble: {
      left: at.x,
      top: at.y,
      right: at.x + BUBBLE_SIZE,
      bottom: at.y + BUBBLE_SIZE,
    },
    window: win,
  }
}
