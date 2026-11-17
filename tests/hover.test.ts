/**
 * 「移出即缩回」的判据。
 *
 * 两条要钉住的：
 * 1. **两个区域算一体**：气泡与窗口之间那条缝必须算在安全区里，否则用户从气泡挪向
 *    窗口点「下一章」时，指针扫过缝隙窗口就缩了。
 * 2. **安全区必须真的包住窗口**（含窗口最右下那一点）。这一条是回归钉子：
 *    早先的安全区来自「渲染后量 DOM」，量到的是弹出动画进行中的框（scale .94），
 *    比真实小约 6%——指针落在窗口右侧/底部那条窄带里被判成移出，窗口自己缩回去了。
 */
import { describe, expect, it } from 'vitest'
import { hoverZone, inZone, rectOf } from '../src/client/hover.js'

const bubble = { left: 100, top: 100, right: 144, bottom: 144 }

describe('hover zone', () => {
  it('只有气泡时，安全区是气泡外扩一圈', () => {
    const z = hoverZone(bubble, null)
    expect(z.left).toBeLessThan(bubble.left)
    expect(z.right).toBeGreaterThan(bubble.right)
    expect(inZone(z, 100, 100)).toBe(true)
  })

  it('浮窗在下：并集覆盖气泡与窗口，缝也在里面', () => {
    const win = { left: 70, top: 150, right: 450, bottom: 610 }
    const z = hoverZone(bubble, win)
    // 气泡底部 144，窗口顶部 150 —— 中间 6px 的缝必须算进安全区
    expect(inZone(z, 120, 147)).toBe(true)
    expect(z.top).toBeLessThanOrEqual(100)
    expect(z.bottom).toBeGreaterThanOrEqual(610)
    expect(z.left).toBeLessThanOrEqual(70)
    expect(z.right).toBeGreaterThanOrEqual(450)
  })

  /**
   * 回归：窗口的**四个角**都必须在安全区里。
   * 这正是「量到动画中的小框」会漏掉的地方——右下角最先掉出去。
   */
  it('窗口的四个角（尤其右下角）都在安全区内', () => {
    const win = { left: 24, top: 78, right: 404, bottom: 358 }
    const z = hoverZone(bubble, win)
    const corners: Array<[number, number]> = [
      [win.left, win.top], [win.right, win.top],
      [win.left, win.bottom], [win.right, win.bottom],
      // 贴着边往里 1px：鼠标压在窗口边框上也算在场
      [win.right - 1, win.bottom - 1],
    ]
    for (const [x, y] of corners) {
      expect(inZone(z, x, y), `(${x},${y}) 应在安全区内`).toBe(true)
    }
  })

  it('窗口比气泡靠右时并集跟着变宽', () => {
    const win = { left: 300, top: 150, right: 680, bottom: 610 }
    const z = hoverZone(bubble, win)
    expect(z.left).toBeLessThanOrEqual(100)  // 气泡左边更左
    expect(z.right).toBeGreaterThanOrEqual(680) // 窗口右边更右
  })

  it('指针在气泡里算在场，在远处的宿主界面上算离场', () => {
    const z = hoverZone(bubble, { left: 70, top: 150, right: 450, bottom: 610 })
    expect(inZone(z, 120, 120)).toBe(true)
    expect(inZone(z, 900, 700)).toBe(false)
  })

  it('窗口在上时并集同样成立', () => {
    const win = { left: 70, top: 40, right: 450, bottom: 90 }
    const z = hoverZone(bubble, win)
    expect(z.top).toBeLessThan(40)
    expect(z.bottom).toBeGreaterThanOrEqual(144)
    expect(inZone(z, 120, 145)).toBe(true)
  })

  it('rectOf 与定位结果同源（同一个四个数，不是第二份抄本）', () => {
    const placed = { x: 24, y: 78, width: 380, height: 280 }
    expect(rectOf(placed)).toEqual({ left: 24, top: 78, right: 404, bottom: 358 })
  })
})
