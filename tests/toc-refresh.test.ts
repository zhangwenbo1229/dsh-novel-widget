// @vitest-environment jsdom
/**
 * 刷新目录（源站更新了书籍）。
 *
 * 三条必须钉住的口径，每条对应一处会出错的细节：
 * 1. **当前章按 URL 认，不按下标认**：源站补章分「末尾追加」与「中间插入」，
 *    后者会让其后所有下标 +1——按下标认就把读者甩到别的章上。
 * 2. **旧的正文本缓存必须作废**：缓存键是下标，插章后下标与正文错位，
 *    继续用会「目录是新的、正文是旧的且串位」。
 * 3. **空目录不作为结果**：拿空表替换手里可用的目录，等于把能读的书变成读不了。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NovelApiError, type NovelApi } from '../src/client/api.js'
import { ReaderSession } from '../src/client/reader-session.js'
import type { ChapterEntry, ShelfEntry } from '../src/client/wire.js'
import { resetPersistedForTest } from '../src/client/persist-bridge.js'

function book(over: Partial<ShelfEntry> = {}): ShelfEntry {
  return {
    sourceId: 's1',
    bookKey: 'https://ex.com/b',
    title: '测试书',
    progress: { chapterIndex: 0, offsetRatio: 0, updatedAt: 0 },
    addedAt: 0,
    sourceName: '某源',
    ...over,
  }
}

const tocOf = (n: number): ChapterEntry[] =>
  Array.from({ length: n }, (_, i) => ({ name: `第${i + 1}章`, url: `https://ex.com/${i}` }))

/** 源站目录可变：模拟「作者刚补了章」 */
function mutableApi(initial: ChapterEntry[]) {
  let toc = initial
  const tocCalls: boolean[] = []
  const patchMeta = vi.fn(async () => book())
  const api = {
    shelf: vi.fn(async () => [book()]),
    toc: vi.fn(async (_s: string, _u: string, refresh?: boolean) => {
      tocCalls.push(refresh === true)
      return toc
    }),
    chapter: vi.fn(async (_s: string, _u: string, i: number) => ({ kind: 'text' as const, text: `正文${i}` })),
    book: vi.fn(async () => ({})),
    saveProgress: vi.fn(async () => book()),
    patchMeta,
  } as unknown as NovelApi
  return { api, patchMeta, tocCalls, setToc: (next: ChapterEntry[]) => { toc = next } }
}

beforeEach(() => { resetPersistedForTest() })

describe('刷新目录', () => {
  it('末尾追加：读者留在原来那一章，总章数更新，章数补回书架', async () => {
    const m = mutableApi(tocOf(10))
    const s = new ReaderSession({ api: m.api })
    await s.open(book({ progress: { chapterIndex: 4, offsetRatio: 0.5, updatedAt: 0 } }))
    s.endJump()

    m.setToc(tocOf(13))          // 源站补了 3 章
    const r = await s.reloadToc()

    expect(r).toMatchObject({ ok: true, total: 13, added: 3, moved: false })
    expect(s.getSnapshot().toc).toHaveLength(13)
    expect(s.getSnapshot().place.chapterIndex).toBe(4)
    // 书架上的章数跟着更新（主面板据此显示）
    expect(m.patchMeta).toHaveBeenCalledWith('https://ex.com/b', { totalChapters: 13 })
    // 这次是「绕过缓存」的取法
    expect(m.tocCalls.at(-1)).toBe(true)
  })

  it('中间插章：读者仍停在原来那一章（靠 URL 认，不靠下标）', async () => {
    const m = mutableApi(tocOf(10))
    const s = new ReaderSession({ api: m.api })
    await s.open(book({ progress: { chapterIndex: 4, offsetRatio: 0, updatedAt: 0 } }))
    s.endJump()
    const urlBefore = s.getSnapshot().toc[4]!.url

    // 在第 1 章之后插入一章：原第 5 章（下标 4）变成下标 5
    m.setToc([
      { name: '第1章', url: 'https://ex.com/0' },
      { name: '新插章', url: 'https://ex.com/new' },
      ...tocOf(10).slice(1),
    ])
    const r = await s.reloadToc()

    expect(r).toMatchObject({ ok: true, total: 11, moved: false })
    const st = s.getSnapshot()
    expect(st.place.chapterIndex).toBe(5)                       // 下标跟着挪
    expect(st.toc[st.place.chapterIndex]!.url).toBe(urlBefore)  // 但仍是同一章
  })

  it('原章在源站消失 ⇒ 退回夹取后的下标，并如实说明「位置变了」', async () => {
    const m = mutableApi(tocOf(10))
    const s = new ReaderSession({ api: m.api })
    await s.open(book({ progress: { chapterIndex: 8, offsetRatio: 0, updatedAt: 0 } }))
    s.endJump()

    // 源站重排了地址格式：老 URL 一个都对不上
    m.setToc(Array.from({ length: 5 }, (_, i) => ({ name: `第${i + 1}章`, url: `https://ex.com/v2/${i}` })))
    const r = await s.reloadToc()

    expect(r).toMatchObject({ ok: true, total: 5, moved: true })
    // 5 章的书、原来在第 9 章 ⇒ 夹到最后一章
    expect(s.getSnapshot().place.chapterIndex).toBe(4)
  })

  it('正文本缓存全部作废：刷新后按新下标重取，而不是复用旧内容', async () => {
    const m = mutableApi(tocOf(10))
    const s = new ReaderSession({ api: m.api })
    await s.open(book({ progress: { chapterIndex: 4, offsetRatio: 0, updatedAt: 0 } }))
    s.endJump()
    await vi.waitFor(() => { expect(s.getSnapshot().slots.get(4)?.status).toBe('ready') })

    // 在第 1 章之后插入一章：老「下标 4」的正文属于老第 5 章，
    // 现在下标 5 才是它，下标 4 变成了新插入的那一章
    m.setToc([
      { name: '第1章', url: 'https://ex.com/0' },
      { name: '新插章', url: 'https://ex.com/new' },
      ...tocOf(10).slice(1),
    ])
    const callsBefore = (m.api.chapter as unknown as { mock: { calls: unknown[][] } }).mock.calls.length
    await s.reloadToc()
    const callsAfter = (m.api.chapter as unknown as { mock: { calls: unknown[][] } }).mock.calls.length
    expect(callsAfter).toBeGreaterThan(callsBefore)   // 确实重新取了

    await vi.waitFor(() => { expect(s.getSnapshot().slots.get(5)?.status).toBe('ready') })
    // 假源的正文带下标：下标 5 的内容必须是「正文5」。若复用了旧缓存，这里会是「正文4」
    const slot = s.getSnapshot().slots.get(5)
    expect(slot).toMatchObject({ status: 'ready', paragraphs: ['正文5'] })
  })

  it('刷新期间进入跳转态（落位照跳转处理）', async () => {
    const m = mutableApi(tocOf(10))
    const s = new ReaderSession({ api: m.api })
    await s.open(book())
    s.endJump()
    await s.reloadToc()
    expect(s.getSnapshot().jumping).toBe(true)
  })

  it('源站返回空目录 ⇒ 保留原目录，如实报失败', async () => {
    const m = mutableApi(tocOf(10))
    const s = new ReaderSession({ api: m.api })
    await s.open(book())
    s.endJump()

    m.setToc([])
    const r = await s.reloadToc()

    expect(r.ok).toBe(false)
    expect(s.getSnapshot().toc).toHaveLength(10)   // 目录没被清掉
  })

  it('取目录失败 ⇒ 保留原目录，报错文案是人话', async () => {
    const m = mutableApi(tocOf(10))
    const api = {
      ...m.api,
      toc: vi.fn()
        .mockResolvedValueOnce(tocOf(10))
        .mockRejectedValue(new NovelApiError('failed', 'FetchFailed', '站点挂了', '站点挂了')),
    } as unknown as NovelApi
    const s = new ReaderSession({ api })
    await s.open(book())
    s.endJump()

    const r = await s.reloadToc()
    expect(r).toMatchObject({ ok: false, message: '站点挂了' })
    expect(s.getSnapshot().toc).toHaveLength(10)
  })

  it('换书之后回来的刷新结果作废（不许污染新书）', async () => {
    let release!: (v: ChapterEntry[]) => void
    const slow = new Promise<ChapterEntry[]>((r) => { release = r })
    const m = mutableApi(tocOf(10))
    const api = {
      ...m.api,
      toc: vi.fn()
        .mockResolvedValueOnce(tocOf(10))   // 打开书 A
        .mockImplementationOnce(() => slow) // 刷新 A（挂住）
        .mockResolvedValue(tocOf(3)),       // 打开书 B
    } as unknown as NovelApi
    const s = new ReaderSession({ api })
    await s.open(book())
    s.endJump()

    const refreshing = s.reloadToc()
    await s.open(book({ bookKey: 'https://ex.com/other', title: '另一本' }))
    release(tocOf(99))
    const r = await refreshing

    expect(r.ok).toBe(false)
    expect(s.getSnapshot().toc).toHaveLength(3)          // B 的目录没被 A 的刷新结果盖掉
    expect(s.getSnapshot().book?.bookKey).toBe('https://ex.com/other')
  })
})
