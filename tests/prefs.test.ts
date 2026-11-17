import { describe, expect, it } from 'vitest'
import {
  clampGeometry,
  DEFAULT_PERSISTED,
  DEFAULT_PREFS,
  FONT_STEPS,
  LINE_HEIGHTS,
  loadPersisted,
  MIN_HEIGHT,
  MIN_WIDTH,
  nearest,
  normalizePersisted,
  savePersisted,
  STORAGE_KEY,
} from '../src/client/prefs.js'

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    dump: () => Object.fromEntries(map),
  }
}

describe('prefs', () => {
  it('坏数据一律回落缺省，不抛', () => {
    expect(normalizePersisted(null)).toEqual(DEFAULT_PERSISTED)
    expect(normalizePersisted('garbage')).toEqual(DEFAULT_PERSISTED)
    expect(normalizePersisted({ prefs: { fontPx: 'big' } }).prefs.fontPx).toBe(DEFAULT_PERSISTED.prefs.fontPx)
  })

  it('越界数值被夹回合法域', () => {
    const p = normalizePersisted({ geometry: { x: 0, y: 0, width: 10, height: 10 } })
    expect(p.geometry.width).toBe(MIN_WIDTH)
    expect(p.geometry.height).toBe(MIN_HEIGHT)
    expect(normalizePersisted({ bubble: { x: -50, y: -5 } }).bubble).toEqual({ x: 0, y: 0, side: null })
  })

  it('字号/行距/栏宽归到最近档位（手改的值不脱钩）', () => {
    expect(nearest(FONT_STEPS, 17)).toBe(16)
    expect(nearest(FONT_STEPS, 27)).toBe(26)
    expect(nearest(LINE_HEIGHTS, 1.9)).toBe(1.8)
    expect(normalizePersisted({ prefs: { fontPx: 17 } }).prefs.fontPx).toBe(16)
  })

  it('认不出的吸附边当自由态（手改坏的值不让气泡凭空跳边）', () => {
    expect(normalizePersisted({ bubble: { x: 10, y: 10, side: 'diagonal' } }).bubble.side).toBeNull()
    expect(normalizePersisted({ bubble: { x: 10, y: 10, side: 'left' } }).bubble.side).toBe('left')
  })

  it('目录顺序缺省正序；只认真正的 true', () => {
    expect(DEFAULT_PREFS.tocDescending).toBe(false)
    expect(normalizePersisted({}).prefs.tocDescending).toBe(false)
    expect(normalizePersisted({ prefs: { tocDescending: true } }).prefs.tocDescending).toBe(true)
    // 手改出来的 "true" / 1 之类不算——否则一个字符串就能把顺序翻掉
    expect(normalizePersisted({ prefs: { tocDescending: 'true' } }).prefs.tocDescending).toBe(false)
    expect(normalizePersisted({ prefs: { tocDescending: 1 } }).prefs.tocDescending).toBe(false)
  })

  it('目录顺序能落盘并读回', () => {
    const s = fakeStorage()
    savePersisted(s, { ...DEFAULT_PERSISTED, prefs: { ...DEFAULT_PREFS, tocDescending: true } })
    expect(loadPersisted(s).prefs.tocDescending).toBe(true)
  })

  it('lastBookKey 空串等于没有', () => {    expect(normalizePersisted({ lastBookKey: '' }).lastBookKey).toBeNull()
    expect(normalizePersisted({ lastBookKey: 'k' }).lastBookKey).toBe('k')
  })

  it('读存储：坏 JSON 回落缺省', () => {
    expect(loadPersisted(fakeStorage({ [STORAGE_KEY]: '{bad json' }))).toEqual(DEFAULT_PERSISTED)
    expect(loadPersisted(null)).toEqual(DEFAULT_PERSISTED)
  })

  it('读写往返', () => {
    const s = fakeStorage()
    const value = { ...DEFAULT_PERSISTED, lastBookKey: 'abc', open: true }
    savePersisted(s, value)
    expect(loadPersisted(s)).toEqual(value)
  })

  it('存不下也不抛（隐私模式 / 配额满）', () => {
    const s = { setItem: () => { throw new Error('QuotaExceeded') } }
    expect(() => savePersisted(s, DEFAULT_PERSISTED)).not.toThrow()
  })

  it('几何夹回视口：至少露出一角可拖', () => {
    const g = clampGeometry({ x: 99999, y: -500, width: 400, height: 500 }, { width: 1200, height: 800 })
    expect(g.x).toBeLessThanOrEqual(1200 - 80)
    expect(g.y).toBeGreaterThanOrEqual(0)
    expect(g.width).toBe(400)
  })

  it('浮窗不超出视口尺寸', () => {
    const g = clampGeometry({ x: 0, y: 0, width: 5000, height: 5000 }, { width: 800, height: 600 })
    expect(g.width).toBe(800)
    expect(g.height).toBe(600)
  })
})
