/**
 * jsdom 缺的几样浏览器 API（本挂件用得到，且宿主真浏览器都有）。
 * 在这些上面打桩不是「让测试通过」，是补齐测试环境与真实运行时之间的差：
 * - ResizeObserver：目录抽屉用它量视口
 * - PointerEvent 的 setPointerCapture / releasePointerCapture：拖拽用
 * - requestAnimationFrame：滚动回写用（jsdom 有，但默认不推进）
 */
class FakeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver
}

// jsdom 没有 PointerEvent 的捕获 API
if (typeof Element !== 'undefined' && !Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = function setPointerCapture(): void {}
  Element.prototype.releasePointerCapture = function releasePointerCapture(): void {}
  Element.prototype.hasPointerCapture = function hasPointerCapture(): boolean { return false }
}

// jsdom 的 rAF 要手动推进；给一个同步版本，滚动回写在测试里立即生效
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0)
    return 1
  }
  ;(globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = () => {}
}
