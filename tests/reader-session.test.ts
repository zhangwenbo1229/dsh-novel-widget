/**
 * 阅读会话的业务时序（假 api 驱动）：
 * - 换书后老请求的结果不许落进来（generation 判定）
 * - 进度只在关键时机写，且同一位置不重复写
 * - 取章失败不冒充空正文
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NovelApiError, type NovelApi } from '../src/client/api.js'
import { ReaderSession } from '../src/client/reader-session.js'
import type { ChapterEntry, ShelfEntry } from '../src/client/wire.js'
import { resetPersistedForTest } from '../src/client/persist-bridge.js'

function book(over: Partial<ShelfEntry> = {}): ShelfEntry {
  return {
    sourceId: 'src-1',
    bookKey: 'https://example.com/book',
    title: '测试书',
    progress: { chapterIndex: 0, offsetRatio: 0, updatedAt: 0 },
    addedAt: 0,
    sourceName: 'demo',
    ...over,
  }
}

function tocOf(n: number): ChapterEntry[] {
  return Array.from({ length: n }, (_, i) => ({ name: `第${i + 1}章`, url: `https://example.com/${i}` }))
}

function fakeApi(over: Partial<NovelApi> = {}): NovelApi {
  return {
    shelf: vi.fn(async () => []),
    toc: vi.fn(async () => tocOf(10)),
    chapter: vi.fn(async (_s: string, _u: string, i: number) => ({ kind: 'text' as const, text: `正文${i}` })),
    book: vi.fn(async () => ({})),
    saveProgress: vi.fn(async () => book()),
    ...over,
  } as NovelApi
}

beforeEach(() => { resetPersistedForTest() })

describe('reader session', () => {
  it('打开书：取目录 → 定窗口 → 填章', async () => {
    const api = fakeApi()
    const s = new ReaderSession({ api })
    await s.open(book())
    const st = s.getSnapshot()
    expect(st.phase).toBe('reading')
    expect(st.toc).toHaveLength(10)
    // 从第 0 章起：窗口 0..3
    expect(st.window).toEqual({ first: 0, last: 3 })
    await vi.waitFor(() => {
      expect(s.getSnapshot().slots.get(0)?.status).toBe('ready')
      expect(s.getSnapshot().slots.get(3)?.status).toBe('ready')
    })
  })

  it('按存档进度落位：窗口跟前言一起对上', async () => {
    const s = new ReaderSession({ api: fakeApi() })
    await s.open(book({ progress: { chapterIndex: 5, offsetRatio: 0.4, updatedAt: 0 } }))
    const st = s.getSnapshot()
    expect(st.place).toEqual({ chapterIndex: 5, offsetRatio: 0.4 })
    expect(st.window).toEqual({ first: 3, last: 8 })
  })

  it('章节取失败落成 failed 槽，不冒充空正文', async () => {
    const api = fakeApi({
      chapter: vi.fn(async () => { throw new NovelApiError('failed', 'FetchFailed', '站点挂了', '站点挂了') }),
    })
    const s = new ReaderSession({ api })
    await s.open(book())
    await vi.waitFor(() => {
      expect(s.getSnapshot().slots.get(0)?.status).toBe('failed')
    })
    const slot = s.getSnapshot().slots.get(0)
    expect(slot).toMatchObject({ status: 'failed', message: '站点挂了' })
  })

  it('图文章节标 rich，不硬当文字渲染', async () => {
    const api = fakeApi({
      chapter: vi.fn(async () => ({ kind: 'rich' as const, documentId: 'd', nodes: [] })),
    })
    const s = new ReaderSession({ api })
    await s.open(book())
    await vi.waitFor(() => { expect(s.getSnapshot().slots.get(0)?.status).toBe('rich') })
  })

  it('跳章会存进度（关键时机之一）', async () => {
    const save = vi.fn(async () => book())
    const s = new ReaderSession({ api: fakeApi({ saveProgress: save }) })
    await s.open(book())
    await s.jumpTo(7)
    expect(save).toHaveBeenCalledWith('https://example.com/book', 7, 0)
  })

  it('同一位置不重复写（去抖）', async () => {
    const save = vi.fn(async () => book())
    const s = new ReaderSession({ api: fakeApi({ saveProgress: save }) })
    await s.open(book())
    await s.flushProgress(3, 0.5)
    await s.flushProgress(3, 0.5)
    await s.flushProgress(3, 0.501)
    expect(save).toHaveBeenCalledTimes(1)
    await s.flushProgress(4, 0.5)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('写进度失败不打断阅读，且允许下次重试', async () => {
    let fail = true
    const save = vi.fn(async () => {
      if (fail) throw new Error('boom')
      return book()
    })
    const s = new ReaderSession({ api: fakeApi({ saveProgress: save }) })
    await s.open(book())
    await s.flushProgress(2, 0.1)
    expect(save).toHaveBeenCalledTimes(1)
    fail = false
    await s.flushProgress(2, 0.1)
    expect(save).toHaveBeenCalledTimes(2)
  })

  it('next/prev 到底/到顶返回 false，不越界', async () => {
    const s = new ReaderSession({ api: fakeApi() })
    await s.open(book({ progress: { chapterIndex: 9, offsetRatio: 0, updatedAt: 0 } }))
    expect(await s.next()).toBe(false)
    await s.jumpTo(0)
    expect(await s.prev()).toBe(false)
  })

  it('growTail 到底后返回 false（不再请求）', async () => {
    const s = new ReaderSession({ api: fakeApi() })
    await s.open(book({ progress: { chapterIndex: 9, offsetRatio: 0, updatedAt: 0 } }))
    expect(await s.growTail()).toBe(false)
  })

  it('换书后老书的响应不落进来', async () => {
    let release!: (v: { kind: 'text'; text: string }) => void
    const slow = new Promise<{ kind: 'text'; text: string }>((r) => { release = r })
    const api = fakeApi({
      chapter: vi.fn()
        .mockImplementationOnce(() => slow)
        .mockImplementation(async () => ({ kind: 'text' as const, text: '新书正文' })),
    })
    const s = new ReaderSession({ api })
    const first = s.open(book({ bookKey: 'bookA', title: 'A' }))
    await new Promise((r) => setTimeout(r, 0))
    const second = s.open(book({ bookKey: 'bookB', title: 'B' }))
    release({ kind: 'text', text: '老书正文' })
    await Promise.all([first, second])
    await vi.waitFor(() => { expect(s.getSnapshot().slots.get(0)?.status).toBe('ready') })
    const slot = s.getSnapshot().slots.get(0)
    expect(slot).toMatchObject({ paragraphs: ['新书正文'] })
    expect(s.getSnapshot().book?.title).toBe('B')
  })

  it('reportScroll 按实测锚点回写位置并裁窗口', async () => {
    const s = new ReaderSession({ api: fakeApi() })
    await s.open(book())
    // 打开也是一次跳转（内容还没到货），先让视图把落位收尾
    s.endJump()
    // 窗口 0..3，每章 100px；滚到第 3 章（章号 2）中段
    s.reportScroll(250, [
      { index: 0, start: 0, height: 100 },
      { index: 1, start: 100, height: 100 },
      { index: 2, start: 200, height: 100 },
      { index: 3, start: 300, height: 100 },
    ])
    expect(s.getSnapshot().place.chapterIndex).toBe(2)
    expect(s.getSnapshot().place.offsetRatio).toBeCloseTo(0.5)
  })

  /**
   * 跳转协议：目标章由 `jumpTo` 定，**落定之前滚动回写一律不作数**。
   * 这条钉住的真机故障：跳转瞬间整屏占位，回写会把目标章改写成窗口里那一章，
   * 于是「点第 21 章跳到第 18 章」，之后每次翻页都从错误位置继续漂。
   */
  it('跳转未落定期间，滚动回写不改位置', async () => {
    const s = new ReaderSession({ api: fakeApi() })
    await s.open(book())
    s.endJump()
    await s.jumpTo(7)
    expect(s.getSnapshot().jumping).toBe(true)
    expect(s.getSnapshot().place.chapterIndex).toBe(7)
    // 占位布局（高度 0）——旧实现会在这里把目标改写成窗口第一章
    s.reportScroll(0, [
      { index: 5, start: 0, height: 0 },
      { index: 6, start: 0, height: 0 },
      { index: 7, start: 0, height: 0 },
      { index: 8, start: 0, height: 0 },
    ])
    expect(s.getSnapshot().place.chapterIndex).toBe(7)
    // 真内容到货后回写（此时落定与否都该算对）
    s.reportScroll(400, [
      { index: 5, start: 0, height: 200 },
      { index: 6, start: 200, height: 200 },
      { index: 7, start: 400, height: 300 },
      { index: 8, start: 700, height: 300 },
    ])
    expect(s.getSnapshot().place.chapterIndex).toBe(7)
  })

  it('endJump 之后回写恢复正常', async () => {
    const s = new ReaderSession({ api: fakeApi() })
    await s.open(book())
    s.endJump()
    await s.jumpTo(7)
    expect(s.getSnapshot().jumping).toBe(true)
    s.endJump()
    expect(s.getSnapshot().jumping).toBe(false)
    s.reportScroll(400, [
      { index: 5, start: 0, height: 200 },
      { index: 6, start: 200, height: 200 },
      { index: 7, start: 400, height: 300 },
      { index: 8, start: 700, height: 300 },
    ])
    expect(s.getSnapshot().place.chapterIndex).toBe(7)
    // 再滚到下一章，回写就该跟上了（说明控制权真的交还了）
    s.reportScroll(900, [
      { index: 5, start: 0, height: 200 },
      { index: 6, start: 200, height: 200 },
      { index: 7, start: 400, height: 300 },
      { index: 8, start: 700, height: 300 },
    ])
    expect(s.getSnapshot().place.chapterIndex).toBe(8)
  })

  it('打开书也进入跳转态（恢复进度同样要落位）', async () => {
    const s = new ReaderSession({ api: fakeApi() })
    await s.open(book({ progress: { chapterIndex: 5, offsetRatio: 0.4, updatedAt: 0 } }))
    expect(s.getSnapshot().jumping).toBe(true)
    expect(s.getSnapshot().place.chapterIndex).toBe(5)
  })

  it('dispose 冲进度并清场', async () => {
    const save = vi.fn(async () => book())
    const s = new ReaderSession({ api: fakeApi({ saveProgress: save }) })
    await s.open(book())
    await s.flushProgress(1, 0.2)
    await s.dispose()
    expect(s.getSnapshot().phase).toBe('idle')
    expect(s.getSnapshot().book).toBeNull()
  })

  it('目录为空 ⇒ error，不是「读到第 0 章空正文」', async () => {
    const s = new ReaderSession({ api: fakeApi({ toc: vi.fn(async () => []) }) })
    await s.open(book())
    expect(s.getSnapshot().phase).toBe('error')
  })

  it('unavailable 错误上屏的是安装指引，不是原始 message', async () => {
    const s = new ReaderSession({
      api: fakeApi({ toc: vi.fn(async () => { throw new NovelApiError('unavailable', 'Unavailable', '404', '404') }) }),
    })
    await s.open(book())
    expect(s.getSnapshot().error?.message).toContain('dsh-novel')
  })
})
