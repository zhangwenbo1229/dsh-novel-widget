/**
 * 视口尺寸订阅（共享一份）。
 *
 * 为什么单独成模块：窗口定位（anchor.ts 的 widgetGeometry）与移出判定的安全区
 * 都要用它。两处各自订阅一次不是性能问题，而是**几何可能差一帧**的正确性问题——
 * 安全区与画出来的框必须由同一份输入算出。
 */

import { useEffect, useState } from 'react'
import type { Viewport } from './anchor.js'

function read(): Viewport {
  return { width: window.innerWidth, height: window.innerHeight }
}

export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(read)
  useEffect(() => {
    // 只监听 resize：scroll 不影响视口坐标，而 innerWidth/innerHeight 变化必伴随 resize
    const onResize = (): void => setVp(read())
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [])
  return vp
}
