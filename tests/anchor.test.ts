/**
 * 浮窗在气泡旁的锚定（纯函数）。
 *
 * 钉的是「浮窗长在气泡旁边」这条用户口径：换了窗口大小、气泡挪到任何角落、
 * 甚至贴着屏幕底边，浮窗都必须在屏幕内、且尖角指着气泡。
 */
import { describe, expect, it } from 'vitest'
import {
  ANCHOR_GAP,
  MIN_VISIBLE_HEIGHT,
  VIEWPORT_MARGIN,
  placeWindow,
} from '../src/client/anchor.js'
import { BUBBLE_SIZE } from '../src/client/snap.js'

const vp = { width: 1400, height: 900 }

describe('window anchoring', () => {
  it('默认长在气泡下方', () => {
    const p = placeWindow({ x: 100, y: 100 }, vp)
    expect(p.side).toBe('below')
    expect(p.y).toBe(100 + BUBBLE_SIZE + ANCHOR_GAP)
  })

  it('尖角指着气泡中心', () => {
    const bubble = { x: 100, y: 100 }
    const p = placeWindow(bubble, vp)
    expect(p.x + p.arrowX).toBeCloseTo(bubble.x + BUBBLE_SIZE / 2, 5)
  })

  it('气泡贴底边时翻到上方', () => {
    const p = placeWindow({ x: 100, y: vp.height - BUBBLE_SIZE - 4 }, vp)
    expect(p.side).toBe('above')
    // 上方：窗口底边在气泡上方 ANCHOR_GAP 处
    expect(p.y + p.height).toBeCloseTo(vp.height - BUBBLE_SIZE - 4 - ANCHOR_GAP, 5)
  })

  it('浮窗始终完整落在视口内', () => {
    const corners = [
      { x: 0, y: 0 },
      { x: vp.width - BUBBLE_SIZE, y: 0 },
      { x: 0, y: vp.height - BUBBLE_SIZE },
      { x: vp.width - BUBBLE_SIZE, y: vp.height - BUBBLE_SIZE },
      { x: vp.width / 2, y: vp.height / 2 },
    ]
    for (const bubble of corners) {
      const p = placeWindow(bubble, vp)
      expect(p.x).toBeGreaterThanOrEqual(VIEWPORT_MARGIN)
      expect(p.y).toBeGreaterThanOrEqual(VIEWPORT_MARGIN)
      expect(p.x + p.width).toBeLessThanOrEqual(vp.width - VIEWPORT_MARGIN + 0.5)
      expect(p.y + p.height).toBeLessThanOrEqual(vp.height - VIEWPORT_MARGIN + 0.5)
    }
  })

  it('尖角不出窗口左右边缘', () => {
    for (const x of [0, vp.width - BUBBLE_SIZE]) {
      const p = placeWindow({ x, y: 300 }, vp)
      expect(p.arrowX).toBeGreaterThan(0)
      expect(p.arrowX).toBeLessThan(p.width)
    }
  })

  it('矮视口：高度收到装得下的程度，但不低于可读下限', () => {
    const tiny = { width: 1400, height: 420 }
    const p = placeWindow({ x: 100, y: 100 }, tiny)
    expect(p.height).toBeGreaterThanOrEqual(MIN_VISIBLE_HEIGHT)
    expect(p.y + p.height).toBeLessThanOrEqual(tiny.height - VIEWPORT_MARGIN + 0.5)
  })

  it('窄视口：宽度跟着视口收', () => {
    const narrow = { width: 420, height: 900 }
    const p = placeWindow({ x: 20, y: 100 }, narrow)
    expect(p.width).toBeLessThanOrEqual(narrow.width - VIEWPORT_MARGIN * 2)
  })

  it('极小视口不产出负尺寸', () => {
    const p = placeWindow({ x: 0, y: 0 }, { width: 260, height: 260 })
    expect(p.width).toBeGreaterThan(0)
    expect(p.height).toBeGreaterThan(0)
  })

  it('每次都按气泡现算：气泡挪了窗口跟着挪', () => {
    const a = placeWindow({ x: 100, y: 100 }, vp)
    const b = placeWindow({ x: 900, y: 100 }, vp)
    expect(a.x).not.toBe(b.x)
    expect(b.x + b.arrowX).toBeCloseTo(900 + BUBBLE_SIZE / 2, 5)
  })
})
