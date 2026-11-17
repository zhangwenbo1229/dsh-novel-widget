import { describe, expect, it } from 'vitest'
import {
  KEEP_AHEAD,
  KEEP_BEHIND,
  extendHead,
  extendTail,
  initialWindow,
  shouldPrefetch,
  toParagraphs,
  trimWindow,
  windowFor,
  windowHas,
} from '../src/client/reader-model.js'

describe('reader window', () => {
  it('首次窗口前 2 后 3，夹在书的首尾', () => {
    expect(initialWindow(10, 100)).toEqual({ first: 8, last: 13 })
    expect(initialWindow(0, 100)).toEqual({ first: 0, last: 3 })
    expect(initialWindow(99, 100)).toEqual({ first: 97, last: 99 })
    expect(initialWindow(0, 0)).toEqual({ first: 0, last: -1 })
  })

  it('窗口没变时返回同一引用（视图据此跳过重排）', () => {
    const w = initialWindow(10, 100)
    expect(windowFor(10, 100, w)).toBe(w)
    expect(windowFor(11, 100, w)).not.toBe(w)
  })

  it('到底时扩尾返回同一引用', () => {
    const w = { first: 97, last: 99 }
    expect(extendTail(w, 100)).toBe(w)
    expect(extendTail({ first: 0, last: 3 }, 100)).toEqual({ first: 0, last: 4 })
  })

  it('到顶时扩头返回同一引用', () => {
    const w = { first: 0, last: 3 }
    expect(extendHead(w)).toBe(w)
    expect(extendHead({ first: 2, last: 5 })).toEqual({ first: 1, last: 5 })
  })

  it('预取判据按屏幕倍数', () => {
    expect(shouldPrefetch(100, 400)).toBe(true)      // < 1.5 屏
    expect(shouldPrefetch(600, 400)).toBe(false)
    expect(shouldPrefetch(-999, 400)).toBe(true)     // 负值按 0
    expect(shouldPrefetch(100, 0)).toBe(false)       // 视口没量到
  })

  it('裁窗口只留当前章前后固定跨度，并点名被裁掉的章', () => {
    const w = { first: 0, last: 20 }
    const { window: next, dropped } = trimWindow(w, 10, 100)
    expect(next).toEqual({ first: 10 - KEEP_BEHIND, last: 10 + KEEP_AHEAD })
    expect(dropped).toHaveLength(21 - (KEEP_BEHIND + KEEP_AHEAD + 1))
    expect(dropped).toContain(0)
    expect(dropped).not.toContain(10)
  })

  it('无需裁剪时返回同一引用', () => {
    const w = initialWindow(10, 100)
    expect(trimWindow(w, 10, 100).window).toBe(w)
    expect(trimWindow(w, 10, 100).dropped).toEqual([])
  })

  it('窗口包含判定', () => {
    const w = { first: 5, last: 9 }
    expect(windowHas(w, 5)).toBe(true)
    expect(windowHas(w, 9)).toBe(true)
    expect(windowHas(w, 4)).toBe(false)
    expect(windowHas(w, 10)).toBe(false)
  })

  it('纯文字切段：空行折叠、首尾空段去掉', () => {
    expect(toParagraphs('一\n二')).toEqual(['一', '二'])
    expect(toParagraphs('一\n\n\n二')).toEqual(['一', '', '二'])
    expect(toParagraphs('\n\n一\n二\n\n')).toEqual(['一', '二'])
    expect(toParagraphs('一\r\n二')).toEqual(['一', '二'])
    expect(toParagraphs('  一  \n  二  ')).toEqual(['一', '二'])
    expect(toParagraphs('')).toEqual([])
  })
})
