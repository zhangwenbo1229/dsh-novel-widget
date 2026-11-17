/**
 * 气泡吸附：存的是「贴哪条边」的语义，不是像素。
 * 这条如果不成立，换个窗口大小吸附就失效——看得见但说不清的回归。
 */
import { describe, expect, it } from 'vitest'
import { BUBBLE_SIZE, EDGE_INSET, SNAP_DISTANCE, bubbleOpacity, clampBubble, resolveBubble, snapOnRelease } from '../src/client/snap.js'

const vp = { width: 1200, height: 800 }

describe('bubble snap', () => {
  it('贴近左边缘 ⇒ 吸左边', () => {
    const r = snapOnRelease(20, 400, vp)
    expect(r.side).toBe('left')
    expect(r.x).toBe(EDGE_INSET)
  })

  it('贴近右边缘 ⇒ 吸右边，且完全在视口内', () => {
    const r = snapOnRelease(vp.width - BUBBLE_SIZE - 10, 400, vp)
    expect(r.side).toBe('right')
    expect(r.x).toBe(vp.width - BUBBLE_SIZE - EDGE_INSET)
    expect(r.x + BUBBLE_SIZE).toBeLessThanOrEqual(vp.width)
  })

  it('贴近上/下边缘各自吸附', () => {
    expect(snapOnRelease(600, 10, vp).side).toBe('top')
    expect(snapOnRelease(600, vp.height - BUBBLE_SIZE - 10, vp).side).toBe('bottom')
  })

  it('四条边都远 ⇒ 不吸附，保持自由位置', () => {
    const r = snapOnRelease(500, 400, vp)
    expect(r.side).toBeNull()
    expect(r.x).toBe(500)
    expect(r.y).toBe(400)
  })

  it('超过吸附距离就不吸（SNAP_DISTANCE 是唯一阈值）', () => {
    expect(snapOnRelease(SNAP_DISTANCE + 10, 400, vp).side).toBeNull()
    expect(snapOnRelease(SNAP_DISTANCE - 1, 400, vp).side).toBe('left')
  })

  it('角落取更近的那条边', () => {
    // 左边 8px，上边 30px ⇒ 应吸左边
    expect(snapOnRelease(8, 30, vp).side).toBe('left')
  })

  it('吸附态的位置按视口现算：换窗口大小仍贴着边', () => {
    const snapped = snapOnRelease(20, 400, vp)
    const small = resolveBubble(snapped, { width: 600, height: 800 })
    expect(small.x).toBe(EDGE_INSET)
    const wide = resolveBubble(snapped, { width: 2000, height: 800 })
    expect(wide.x).toBe(EDGE_INSET)
  })

  it('右侧吸附在极窄视口下不越界', () => {
    const snapped = { x: 0, y: 100, side: 'right' as const }
    const p = resolveBubble(snapped, { width: 60, height: 400 })
    expect(p.x).toBeGreaterThanOrEqual(EDGE_INSET)
    expect(p.x + BUBBLE_SIZE).toBeGreaterThanOrEqual(60 - EDGE_INSET)
  })

  it('自由态夹进视口', () => {
    expect(clampBubble(-100, -100, vp)).toEqual({ x: EDGE_INSET, y: EDGE_INSET })
    const far = clampBubble(99999, 99999, vp)
    expect(far.x + BUBBLE_SIZE).toBeLessThanOrEqual(vp.width)
    expect(far.y + BUBBLE_SIZE).toBeLessThanOrEqual(vp.height)
  })

  it('吸附时降透明度，悬停/聚焦回到 1', () => {
    expect(bubbleOpacity(null, false)).toBe(1)
    expect(bubbleOpacity('left', false)).toBeLessThan(1)
    expect(bubbleOpacity('left', true)).toBe(1)
  })
})
