/**
 * 进度数学的互逆性：这一条如果破了，挂件与主面板就会互相拉扯位置。
 *
 * 还有一条同样重要：**量不出来时必须返回 null**。跳转的瞬间整屏都是「加载中」占位，
 * 拿这种布局去定位会把用户刚点的目标章改写成窗口里那一章——真机上就是
 * 「点第 21 章跳到第 18 章」，之后每次上一章/下一章都从错误位置继续漂。
 */
import { describe, expect, it } from 'vitest'
import { anchorTop, buildAnchors, locateChapter, ratioWithin, samePlace } from '../src/client/progress.js'

describe('progress math', () => {
  const anchors = buildAnchors(10, [500, 800, 300])

  it('锚点起点按高度累加', () => {
    expect(anchors).toEqual([
      { index: 10, start: 0, height: 500 },
      { index: 11, start: 500, height: 800 },
      { index: 12, start: 1300, height: 300 },
    ])
  })

  it('章内比例夹在 0..1', () => {
    expect(ratioWithin(anchors[0]!, -50)).toBe(0)
    expect(ratioWithin(anchors[0]!, 250)).toBeCloseTo(0.5)
    expect(ratioWithin(anchors[0]!, 9999)).toBe(1)
    // 高度没量到 → 0（不是 NaN）
    expect(ratioWithin({ index: 0, start: 0, height: 0 }, 100)).toBe(0)
  })

  it('定位取起点不晚于滚动位的最大锚点', () => {
    expect(locateChapter(anchors, 0)).toEqual({ chapterIndex: 10, offsetRatio: 0 })
    expect(locateChapter(anchors, 250)!.chapterIndex).toBe(10)
    expect(locateChapter(anchors, 500)!.chapterIndex).toBe(11)
    expect(locateChapter(anchors, 1300)!.chapterIndex).toBe(12)
  })

  it('空表返回 null（没有可信锚点，就不猜）', () => {
    expect(locateChapter([], 123)).toBeNull()
  })

  it('存与取互逆（同一跨度口径）', () => {
    const scrollHeight = 1600
    const clientHeight = 400
    for (const chapterIndex of [10, 11, 12]) {
      for (const ratio of [0, 0.25, 0.5, 0.9]) {
        const top = anchorTop(anchors, chapterIndex, ratio, scrollHeight, clientHeight)
        expect(top).not.toBeNull()
        const back = locateChapter(anchors, top!)
        expect(back).not.toBeNull()
        // 被内容底部夹住时章会变（夹取是真实行为），所以只验未被夹的区间
        if (top! < scrollHeight - clientHeight) {
          expect(back!.chapterIndex).toBe(chapterIndex)
          expect(Math.abs(back!.offsetRatio - ratio)).toBeLessThan(0.02)
        }
      }
    }
  })

  it('章未加载时反函数返回 null，而不是猜一个位置', () => {
    expect(anchorTop(anchors, 99, 0.5, 2000, 400)).toBeNull()
  })

  it('反函数不越过内容底', () => {
    const top = anchorTop(anchors, 12, 1, 1600, 400)
    expect(top).toBe(1200) // 1600-400
  })

  it('同一位置判定容忍滚动抖动', () => {
    expect(samePlace({ chapterIndex: 3, offsetRatio: 0.5 }, { chapterIndex: 3, offsetRatio: 0.501 })).toBe(true)
    expect(samePlace({ chapterIndex: 3, offsetRatio: 0.5 }, { chapterIndex: 3, offsetRatio: 0.52 })).toBe(false)
    expect(samePlace({ chapterIndex: 3, offsetRatio: 0.5 }, { chapterIndex: 4, offsetRatio: 0.5 })).toBe(false)
  })

  /**
   * 真机故障的回归钉子：整屏占位（首章高度为 0）时**不许**把位置归给任何一章。
   * 旧实现会回退成「窗口第一章」，于是用户点的第 21 章被改写成第 18 章。
   */
  it('首章未测到高度 ⇒ 返回 null，不把滚动位判给任何章', () => {
    const a = buildAnchors(0, [0, 400])
    expect(locateChapter(a, 0)).toBeNull()
    expect(locateChapter(a, 400)).toBeNull()
  })

  it('全都没测到 ⇒ 返回 null', () => {
    expect(locateChapter(buildAnchors(18, [0, 0, 0, 0, 0, 0]), 0)).toBeNull()
  })

  it('全部量到之后归属恢复正常', () => {
    const a = buildAnchors(0, [500, 400])
    expect(locateChapter(a, 400)!.chapterIndex).toBe(0)
    expect(locateChapter(a, 500)!.chapterIndex).toBe(1)
    expect(locateChapter(a, 700)!.chapterIndex).toBe(1)
  })
})
