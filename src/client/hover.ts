/**
 * 「移出即缩回」的悬停判据（纯函数 + 一个订阅器）。
 *
 * 气泡像消息提示那样弹出来，鼠标移走就自己缩回去——但**两个区域要算作一体**：
 * 气泡本身与浮窗（还有它们之间那段尖角缝隙）。否则用户想从气泡移到窗口里点「下一章」，
 * 指针只要扫过中间那条缝，窗口就缩了，根本点不到。
 *
 * 所以判据是**区域集合的并集**：指针落在任何一个区域内都算「还在看」；
 * 全部离开后才开始倒计时缩回。
 *
 * **安全区必须来自几何推导，不许去量 DOM**（这一条是踩过坑写下的）：
 * 早先的做法是渲染后读 `getBoundingClientRect()` 交给本模块，结果量到的是弹出动画
 * 进行中的框（`scale(.94)`，比真实小约 6%），而动画结束后没人重新量——安全区就永远
 * 小一圈。用户把鼠标移到窗口右侧/底部那条窄带里（视觉上明明还在正文上），
 * 判定为「已移出」，窗口在他眼皮底下自己缩了回去。
 *
 * 现在两个矩形都来自 `anchor.ts` 的 `widgetGeometry`：那是**元素最终占据的盒子**，
 * 与定位用的是同一份推导，且天然不受动画 transform 影响。
 *
 * 两个细节：
 * - 倒计时用 `delayMs`（缺省 500ms）：瞬间缩回太急躁，用户刚移出去想移回来就没了。
 * - 拖动气泡期间**不缩回**（`locked`）：拖动必然会把指针带出区域，不锁就会边拖边缩。
 */

export interface Rect { left: number; top: number; right: number; bottom: number }

/**
 * 把气泡矩形与窗口矩形并成一个「安全区」；指针在这一片之内都不算离开。
 *
 * 四边都外扩 `gap`：一是覆盖气泡与窗口之间那段尖角缝隙，二是贴着边缘时不因
 * 一两个像素的抖动被判成移出。窗口还没打开时（`window === null`）只返回气泡那一块。
 */
export function hoverZone(bubble: Rect, window: Rect | null, gap = 12): Rect {
  if (window === null) {
    return { ...bubble, left: bubble.left - gap, top: bubble.top - gap, right: bubble.right + gap, bottom: bubble.bottom + gap }
  }
  return {
    left: Math.min(bubble.left, window.left) - gap,
    top: Math.min(bubble.top, window.top) - gap,
    right: Math.max(bubble.right, window.right) + gap,
    bottom: Math.max(bubble.bottom, window.bottom) + gap,
  }
}

/** 点是否落在区域内（含边界） */
export function inZone(zone: Rect, x: number, y: number): boolean {
  return x >= zone.left && x <= zone.right && y >= zone.top && y <= zone.bottom
}

/** 窗口的定位结果 → 命中判定用的矩形（同一份四个数，避免第二个抄本） */
export function rectOf(placed: { x: number; y: number; width: number; height: number }): Rect {
  return {
    left: placed.x,
    top: placed.y,
    right: placed.x + placed.width,
    bottom: placed.y + placed.height,
  }
}

/**
 * 元素**真正在屏幕上**占据的矩形。
 *
 * 命中判定必须量它，不能照我们写进 CSS 的 `left/top` 推算——两者在真实宿主里会分叉：
 * 应用外壳的某个祖先带 `transform` / `will-change`（做合成层）时，这个祖先会成为
 * `position: fixed` 的包含块，窗口被画在「祖先偏移 + 我们给的值」处，而 `clientX/clientY`
 * 是视口坐标。于是「我们以为它在哪」与「它在哪」差了一整个祖先偏移，判定区整体错位，
 * 鼠标明明在窗口里却判成已移出。
 *
 * 量出来的是视口坐标，与 `clientX/clientY` 同一坐标系，所以它才是判定该用的那份数。
 */
export function rectOfElement(el: Element): Rect {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
}

/**
 * 一次「移出后缩回」的守望。
 *
 * 用 `pointermove` 而不是 `mouseleave`：窗口是有子元素的一整棵树，`mouseleave` 会在
 * 子元素之间穿梭时误触发；坐标判定永远可靠，且能和拖动、滚动条、iframe 之类的情况一致。
 * 监听挂在 document（捕获阶段），所以指针移到宿主界面上任何地方都能收到。
 *
 * 返回取消函数（组件卸载时调）。
 */
export function watchHoverExit(options: {
  getZone: () => Rect
  isLocked: () => boolean
  onExit: () => void
  delayMs?: number
}): () => void {
  const delay = options.delayMs ?? 500
  let timer: number | null = null
  /** 指针最后已知位置（-1 = 未知）。计时到点时拿它复核，见 fire() */
  let last = { x: -1, y: -1 }

  const cancel = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
  }

  /**
   * 计时到点：**再复核一次**才缩回。
   *
   * 为什么需要这道复核：起计时的判据是「某一刻指针在安全区外」，而到点前指针可能已经
   * 回来了（浏览器对静止指针不再派 pointermove，所以回来那次未必能取消计时）；也可能是
   * 安全区本身挪了位（窗口翻到气泡另一侧）。用最后已知位置对照当前安全区，能把这些
   * 「其实还在窗口里」的误判拦在最后一刻。
   */
  const fire = (): void => {
    timer = null
    if (options.isLocked()) return
    if (last.x >= 0 && last.y >= 0 && inZone(options.getZone(), last.x, last.y)) return
    options.onExit()
  }

  const start = (): void => {
    if (timer !== null) return // 已在倒计时，别每次移动都重置
    timer = window.setTimeout(fire, delay)
  }

  const onMove = (e: PointerEvent): void => {
    last = { x: e.clientX, y: e.clientY }
    if (options.isLocked()) { cancel(); return }
    if (inZone(options.getZone(), e.clientX, e.clientY)) { cancel(); return }
    start()
  }

  /**
   * 指针离开整个文档（切窗口 / 移到浏览器 UI）。
   *
   * **只认根元素上的 leave**。监听挂在 document 上、用捕获阶段，会把**任何后代**的
   * pointerleave 都收进来；而滚动正文时浏览器会不断为「从指针下方滚走的段落」派发
   * pointerleave（实测 target 是 `P` / `DIV`，relatedTarget 分别是 `dnw-prose` / `BODY`）。
   * 不甄别目标的话，滚一下阅读窗就等于「鼠标离开了页面」→ 起计时；而用户只是滚轮、
   * 指针没动，没有 pointermove 来取消 → 0.5 秒后窗口自己缩回。
   */
  const onLeaveDocument = (e: PointerEvent): void => {
    const t = e.target
    const atRoot = t === document || t === document.documentElement || t === document.body
    if (!atRoot) return
    if (options.isLocked()) return
    // 指针真的离开文档了：位置未知，别再拿旧位置复核（否则会把这次合法缩回抵消掉）
    last = { x: -1, y: -1 }
    start()
  }

  document.addEventListener('pointermove', onMove, { capture: true, passive: true })
  document.addEventListener('pointerleave', onLeaveDocument, { capture: true })
  return () => {
    cancel()
    document.removeEventListener('pointermove', onMove, { capture: true })
    document.removeEventListener('pointerleave', onLeaveDocument, { capture: true })
  }
}
