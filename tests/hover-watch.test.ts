// @vitest-environment jsdom
/**
 * 守望器本身的行为（`watchHoverExit`）。
 *
 * 这一组针对的都是「鼠标还在窗口里，窗口却自己缩回」的成因——每一个都对应一次真机故障：
 * 1. **滚动正文**：浏览器为「从指针下方滚走的段落」派 pointerleave，
 *    不加甄别就会被当成「鼠标离开页面」→ 起计时 → 指针没动、无人取消 → 缩回。
 * 2. **安全区挪位**：起计时后窗口翻到气泡另一侧，指针其实落在新框里。
 * 3. **移出后回来**：指针回到区内，必须取消。
 * 而「真的离开」这条路也必须仍然成立，否则就成了永不缩回。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchHoverExit, type Rect } from '../src/client/hover.js'

/** 安全区可变的守望器：多条用例要模拟「框挪了」 */
function setup(initial: Rect, opts: { locked?: boolean } = {}) {
  let zone = initial
  const onExit = vi.fn()
  const stop = watchHoverExit({
    getZone: () => zone,
    isLocked: () => opts.locked === true,
    onExit,
    delayMs: 500,
  })
  return { onExit, stop, setZone: (z: Rect) => { zone = z } }
}

const INSIDE: Rect = { left: 0, top: 0, right: 400, bottom: 400 }
const OUTSIDE: Rect = { left: 1000, top: 1000, right: 1100, bottom: 1100 }

/** 在某个元素上派发事件（捕获阶段的 document 监听会收到） */
function dispatchOn(target: EventTarget, type: string, init: PointerEventInit = {}): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, ...init }))
}

/** 模拟「正文段落从指针下方滚走」：目标是一个普通元素，relatedTarget 是别的元素 */
function scrollInducedLeave(): void {
  const p = document.createElement('p')
  const prose = document.createElement('div')
  document.body.append(prose)
  prose.append(p)
  dispatchOn(p, 'pointerleave', { relatedTarget: prose })
  dispatchOn(p, 'pointerout', { relatedTarget: prose })
  p.remove()
  prose.remove()
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('移出守望器', () => {
  it('指针在安全区内 ⇒ 不缩回', () => {
    const { onExit } = setup(INSIDE)
    dispatchOn(document, 'pointermove', { clientX: 200, clientY: 200 })
    vi.advanceTimersByTime(1000)
    expect(onExit).not.toHaveBeenCalled()
  })

  it('指针移到安全区外 ⇒ 到点缩回', () => {
    const { onExit } = setup(INSIDE)
    dispatchOn(document, 'pointermove', { clientX: 900, clientY: 900 })
    vi.advanceTimersByTime(600)
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  /**
   * 真机故障 1 的回归钉子：滚动正文产生的后代 pointerleave 绝不能起计时。
   */
  it('正文滚动产生的后代 pointerleave ⇒ 不缩回', () => {
    const { onExit } = setup(INSIDE)
    dispatchOn(document, 'pointermove', { clientX: 200, clientY: 200 })
    for (let i = 0; i < 20; i += 1) scrollInducedLeave()
    vi.advanceTimersByTime(2000)
    expect(onExit).not.toHaveBeenCalled()
  })

  it('真的离开文档（根元素上的 leave）⇒ 仍会缩回', () => {
    const { onExit } = setup(INSIDE)
    dispatchOn(document.body, 'pointerleave', { relatedTarget: null })
    vi.advanceTimersByTime(600)
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  it('移出后又回到区内 ⇒ 取消缩回', () => {
    const { onExit } = setup(INSIDE)
    dispatchOn(document, 'pointermove', { clientX: 900, clientY: 900 })
    dispatchOn(document, 'pointermove', { clientX: 200, clientY: 200 })
    vi.advanceTimersByTime(1000)
    expect(onExit).not.toHaveBeenCalled()
  })

  /** 真机故障 2 的回归钉子：到点时若指针其实落在当前安全区里，这次缩回作废 */
  it('起计时后安全区挪到指针脚下 ⇒ 到点复核时取消', () => {
    const { onExit, setZone } = setup(INSIDE)
    dispatchOn(document, 'pointermove', { clientX: 900, clientY: 900 })
    setZone(OUTSIDE)          // 判成「在外面」时的那个框已经不含指针了
    setZone({ left: 800, top: 800, right: 1000, bottom: 1000 })  // 新框把指针包回来
    vi.advanceTimersByTime(600)
    expect(onExit).not.toHaveBeenCalled()
  })

  it('上锁（开抽屉）期间不起计时；解锁后到点才缩回', () => {
    const locked = { value: true }
    let zone: Rect = INSIDE
    const onExit = vi.fn()
    const stop = watchHoverExit({
      getZone: () => zone,
      isLocked: () => locked.value,
      onExit,
      delayMs: 500,
    })
    dispatchOn(document, 'pointermove', { clientX: 900, clientY: 900 })
    vi.advanceTimersByTime(1000)
    expect(onExit).not.toHaveBeenCalled()
    locked.value = false
    dispatchOn(document, 'pointermove', { clientX: 900, clientY: 900 })
    vi.advanceTimersByTime(600)
    expect(onExit).toHaveBeenCalledTimes(1)
    stop()
  })

  it('取消订阅之后不再响应任何事件', () => {
    const { onExit, stop } = setup(INSIDE)
    stop()
    dispatchOn(document, 'pointermove', { clientX: 900, clientY: 900 })
    dispatchOn(document.body, 'pointerleave', { relatedTarget: null })
    vi.advanceTimersByTime(2000)
    expect(onExit).not.toHaveBeenCalled()
  })
})
