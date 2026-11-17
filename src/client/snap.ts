/**
 * 气泡的贴边吸附（纯函数）。
 *
 * 为什么吸附值得单独一层：它有两个「何时生效」的时机，混在一起就会打架——
 * 1. **拖动结束时**决定吸附到哪条边（`snapOnRelease`）；
 * 2. **每次渲染时**把位置按当前视口重新贴合（`resolveBubble`），否则换个窗口大小、
 *    或者刷新后视口变了，吸附过的气泡就停在离边缘很远的地方，「吸附」名存实亡。
 *
 * 所以存下来的是**语义**（贴在哪条边），不是像素。像素每次按视口现算。
 *
 * 距离判据：拖动结束时距某条边不超过 `SNAP_DISTANCE` 就贴上去；四条边都远就保持自由位置。
 * 角上优先贴更近的那条边——两条都满足时取距离更小的，避免「往角落一扔却跳去另一侧」。
 */

export type BubbleSide = 'left' | 'right' | 'top' | 'bottom' | null

/** 气泡直径（与 CSS 的 .dnw-bubble 一致） */
export const BUBBLE_SIZE = 44
/** 贴边后距边缘留的缝：完全贴死会让焦点圈与投影被裁掉 */
export const EDGE_INSET = 6
/** 松手时距边多远算「要吸附」 */
export const SNAP_DISTANCE = 40

export interface BubblePos {
  x: number
  y: number
  side: BubbleSide
}

export interface Viewport { width: number; height: number }

/** 把坐标夹进视口（气泡至少完整可见，留一点缝） */
export function clampBubble(x: number, y: number, viewport: Viewport): { x: number; y: number } {
  const maxX = Math.max(0, viewport.width - BUBBLE_SIZE - EDGE_INSET)
  const maxY = Math.max(0, viewport.height - BUBBLE_SIZE - EDGE_INSET)
  return {
    x: Math.min(maxX, Math.max(EDGE_INSET, x)),
    y: Math.min(maxY, Math.max(EDGE_INSET, y)),
  }
}

/** 按「贴哪条边」现算像素位置；自由态（side=null）只做夹取 */
export function resolveBubble(pos: BubblePos, viewport: Viewport): { x: number; y: number } {
  const free = clampBubble(pos.x, pos.y, viewport)
  switch (pos.side) {
    case 'left': return { x: EDGE_INSET, y: free.y }
    case 'right': return { x: Math.max(EDGE_INSET, viewport.width - BUBBLE_SIZE - EDGE_INSET), y: free.y }
    case 'top': return { x: free.x, y: EDGE_INSET }
    case 'bottom': return { x: free.x, y: Math.max(EDGE_INSET, viewport.height - BUBBLE_SIZE - EDGE_INSET) }
    default: return free
  }
}

/** 拖动结束：离哪条边够近就吸附过去，否则保持自由位置（但仍夹在视口内） */
export function snapOnRelease(x: number, y: number, viewport: Viewport): BubblePos {
  const free = clampBubble(x, y, viewport)
  const distance = {
    left: free.x,
    right: viewport.width - (free.x + BUBBLE_SIZE),
    top: free.y,
    bottom: viewport.height - (free.y + BUBBLE_SIZE),
  }
  // 取最短距离的那条边；ties 按 left→right→top→bottom 的固定顺序，保证结果可复现
  const order: Array<Exclude<BubbleSide, null>> = ['left', 'right', 'top', 'bottom']
  let best: Exclude<BubbleSide, null> | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const side of order) {
    const d = distance[side]
    if (d < bestDistance) { best = side; bestDistance = d }
  }
  if (best === null || bestDistance > SNAP_DISTANCE) return { ...free, side: null }
  return { ...resolveBubble({ ...free, side: best }, viewport), side: best }
}

/** 吸附态的透明度（自由态恒 1）。降不透明是为了「让开」底下的界面，
 *  悬停/聚焦时必须回到 1——否则用户点不准一个半透明的圆点。 */
export function bubbleOpacity(side: BubbleSide, hovering: boolean): number {
  if (side === null) return 1
  return hovering ? 1 : 0.42
}
