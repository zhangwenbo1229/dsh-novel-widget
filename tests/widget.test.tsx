// @vitest-environment jsdom
/**
 * 组件层：假 adapter 驱动真实组件（不做渲染快照）。
 *
 * 钉的是三件在真机上最容易坏、而纯函数测不到的事：
 * 1. 书架为空 / 未安装 dsh-novel 时**说得出话**（不是一片空白）
 * 2. 点一本书能进到正文，且正文就是接口给的那几段
 * 3. 气泡点击开合浮窗、关窗时冲进度
 */
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApi, NovelApiError, type NovelApi } from '../src/client/api.js'
import { resetPersistedForTest } from '../src/client/persist-bridge.js'
import { bindStorage } from '../src/client/persist-bridge.js'
import { getState, setOpen } from '../src/client/state.js'
import { NovelWidget } from '../src/client/views/NovelWidget.js'
import type { ChapterEntry, ShelfEntry } from '../src/client/wire.js'

function book(over: Partial<ShelfEntry> = {}): ShelfEntry {
  return {
    sourceId: 's1',
    bookKey: 'https://ex.com/b',
    title: '测试书',
    author: '某作者',
    progress: { chapterIndex: 0, offsetRatio: 0, updatedAt: 0 },
    addedAt: 0,
    sourceName: '某源',
    ...over,
  }
}

function tocOf(n: number): ChapterEntry[] {
  return Array.from({ length: n }, (_, i) => ({ name: `第${i + 1}章`, url: `https://ex.com/${i}` }))
}

function fakeApi(over: Partial<NovelApi> = {}): NovelApi {
  return {
    shelf: vi.fn(async () => [book()]),
    toc: vi.fn(async () => tocOf(5)),
    chapter: vi.fn(async (_s: string, _u: string, i: number) => ({ kind: 'text' as const, text: `第一段${i}\n第二段${i}` })),
    book: vi.fn(async () => ({})),
    saveProgress: vi.fn(async () => book()),
    ...over,
  } as NovelApi
}

/** 内存版 localStorage（jsdom 有，但每个用例要干净） */
function storage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { map.delete(k) },
    setItem: (k: string, v: string) => { map.set(k, v) },
  } as Storage
}

/**
 * 每个用例都从「关着」开始。
 *
 * 为什么必须显式重置：挂件的开合住在**模块级 store**（跨卸载不丢——那正是它的设计），
 * 所以模块只加载一次、状态会跨用例残留。上一个用例结束时 `open: true`，下一个用例
 * 点气泡就变成「关」而不是「开」，断言于是全部落空。store 的行为本身没毛病，
 * 漏掉这一步的是测试。
 */
beforeEach(() => {
  resetPersistedForTest()
  bindStorage(storage())
  if (getState().open) setOpen(false)
})

describe('novel widget', () => {
  it('书架为空时说清楚怎么办，而不是空白', async () => {
    const api = fakeApi({ shelf: vi.fn(async () => []) })
    render(<NovelWidget api={api} />)
    await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
    await waitFor(() => { expect(screen.getByText('书架是空的')).toBeTruthy() })
    expect(screen.getByText(/先在「小说」面板里找一本/)).toBeTruthy()
  })

  it('未安装 dsh-novel 时给安装指引', async () => {
    const api = fakeApi({
      shelf: vi.fn(async () => { throw new NovelApiError('unavailable', 'Unavailable', '404', '404') }),
    })
    const { container } = render(<NovelWidget api={api} />)
    await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
    // 断言走容器文本：<style> 也带文本，getByText 的默认 ignore 只排 script/style 标签本身
    await waitFor(() => { expect(container.textContent).toContain('请确认已安装并启用了 dsh-novel') })
    expect(screen.getByText('读书架失败')).toBeTruthy()
  })

  it('自动续上上次那本并渲染正文', async () => {
    const api = fakeApi()
    render(<NovelWidget api={api} />)
    await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
    await waitFor(() => { expect(screen.getByText('第一段0')).toBeTruthy() })
    expect(screen.getByText('第二段0')).toBeTruthy()
    // 气泡头显示章名（对话气泡形态：章名在气泡顶上，不是正文里的大标题）
    expect(screen.getByText('第1章')).toBeTruthy()
    // 标题栏已隐藏：书名不再上屏，可见的是章名与正文
    expect(screen.queryByText('测试书')).toBeNull()
  })

  it('气泡再点一次收起，收起时冲进度', async () => {
    const save = vi.fn(async () => book())
    const api = fakeApi({ saveProgress: save })
    render(<NovelWidget api={api} />)
    const bubble = screen.getByRole('button', { name: '打开阅读挂件' })
    await userEvent.click(bubble)
    await waitFor(() => { expect(screen.getByText('第一段0')).toBeTruthy() })
    // 打开后气泡的可访问名不变（同一个入口按钮）
    await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
    await waitFor(() => { expect(screen.queryByText('第一段0')).toBeNull() })
    expect(save).toHaveBeenCalled()
  })

  it('目录抽屉列出章并能跳章', async () => {
    const api = fakeApi()
    render(<NovelWidget api={api} />)
    await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
    await waitFor(() => { expect(screen.getByText('第一段0')).toBeTruthy() })
    await userEvent.click(screen.getByRole('button', { name: '目录' }))
    await waitFor(() => { expect(screen.getByText('共 5 章')).toBeTruthy() })
    await userEvent.click(screen.getByRole('button', { name: '第3章' }))
    await waitFor(() => { expect(screen.getByText('第一段2')).toBeTruthy() })
  })

  it('章节取不到时就地给重试，而不是空白正文', async () => {
    const api = fakeApi({
      chapter: vi.fn(async () => { throw new NovelApiError('failed', 'FetchFailed', '站点挂了', '站点挂了') }),
    })
    render(<NovelWidget api={api} />)
    await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
    // 窗口里多章同时失败 ⇒ 每条各出一句；断言「至少有一条」而不是「唯一一条」
    await waitFor(() => { expect(screen.getAllByText('这一章没取到').length).toBeGreaterThan(0) })
    expect(screen.getAllByRole('button', { name: '重试' }).length).toBeGreaterThan(0)
  })
})

describe('移出即缩回', () => {
  /** 让浮窗有真实矩形（jsdom 默认全 0，会让安全区退化成一个点） */
  function stubRects(): () => void {
    const orig = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = function patched(this: HTMLElement) {
      if (this.classList.contains('dnw-window')) {
        return { x: 40, y: 90, left: 40, top: 90, right: 420, bottom: 550, width: 380, height: 460, toJSON: () => ({}) } as DOMRect
      }
      if (this.classList.contains('dnw-bubble')) {
        return { x: 20, y: 20, left: 20, top: 20, right: 64, bottom: 64, width: 44, height: 44, toJSON: () => ({}) } as DOMRect
      }
      return orig.call(this)
    }
    return () => { HTMLElement.prototype.getBoundingClientRect = orig }
  }

  const move = (x: number, y: number): void => {
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }))
  }

  it('指针移出安全区并停留 ⇒ 自动收起', async () => {
    const restore = stubRects()
    try {
      const api = fakeApi()
      render(<NovelWidget api={api} />)
      await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
      await waitFor(() => { expect(screen.getByText('第一段0')).toBeTruthy() })

      // 在气泡与窗口的并集之外
      act(() => { move(1200, 900) })
      await waitFor(() => { expect(screen.queryByText('第一段0')).toBeNull() }, { timeout: 3000 })
    } finally {
      restore()
    }
  })

  it('指针从气泡移到浮窗（穿过缝）⇒ 不收起', async () => {
    const restore = stubRects()
    try {
      const api = fakeApi()
      render(<NovelWidget api={api} />)
      await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
      await waitFor(() => { expect(screen.getByText('第一段0')).toBeTruthy() })

      // 连续在安全区内移动（气泡内 → 缝里 → 窗口内），中途不该缩回
      const path: Array<[number, number]> = [[40, 40], [50, 70], [60, 300], [200, 300]]
      for (const [x, y] of path) {
        act(() => { move(x, y) })
      }
      await new Promise((r) => setTimeout(r, 900))
      expect(screen.getByText('第一段0')).toBeTruthy()
    } finally {
      restore()
    }
  })

  it('打开目录后钉住：移出也不收起（正在找章）', async () => {
    const restore = stubRects()
    try {
      const api = fakeApi()
      render(<NovelWidget api={api} />)
      await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
      await waitFor(() => { expect(screen.getByText('第一段0')).toBeTruthy() })
      await userEvent.click(screen.getByRole('button', { name: '目录' }))
      await waitFor(() => { expect(screen.getByText('共 5 章')).toBeTruthy() })

      act(() => { move(1200, 900) })
      await new Promise((r) => setTimeout(r, 900))
      // 目录还在，正文也还在
      expect(screen.getByText('共 5 章')).toBeTruthy()
    } finally {
      restore()
    }
  })
  /**
   * 用户报的 bug：鼠标移到阅读背景上、还没移出，窗口就自己缩回去了。
   * 场景要点是「进入之后不再移动」——所以只发一次 pointermove，然后等过防抖窗。
   */
  it('指针停在阅读背景上不再移动 ⇒ 不缩回', async () => {
    const restore = stubRects()
    try {
      const api = fakeApi()
      render(<NovelWidget api={api} />)
      await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
      await waitFor(() => { expect(screen.getByText('第一段0')).toBeTruthy() })
      // 落点在窗口矩形（40,90)-(420,550) 之内，气泡（20,20)-(64,64) 之外
      act(() => { move(200, 300) })
      await new Promise((r) => setTimeout(r, 900))
      expect(screen.getByText('第一段0')).toBeTruthy()
    } finally {
      restore()
    }
  })

  /** 同上，但先把鼠标在窗口里挪几下（真实用户会轻微移动） */
  it('指针在阅读背景内小幅移动 ⇒ 不缩回', async () => {
    const restore = stubRects()
    try {
      const api = fakeApi()
      render(<NovelWidget api={api} />)
      await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
      await waitFor(() => { expect(screen.getByText('第一段0')).toBeTruthy() })
      const path: Array<[number, number]> = [[200, 300], [210, 320], [230, 340], [250, 360]]
      for (const [x, y] of path) { act(() => { move(x, y) }) }
      await new Promise((r) => setTimeout(r, 900))
      expect(screen.getByText('第一段0')).toBeTruthy()
    } finally {
      restore()
    }
  })

})


describe('右键换书', () => {
  it('右键气泡弹出菜单并列出书架上的书', async () => {
    const api = fakeApi({
      shelf: vi.fn(async () => [book(), book({ bookKey: 'https://ex.com/b2', title: '第二本书' })]),
    })
    render(<NovelWidget api={api} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: '打开阅读挂件' })).toBeTruthy() })
    const bubble = screen.getByRole('button', { name: '打开阅读挂件' })
    act(() => {
      bubble.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }))
    })
    await waitFor(() => { expect(screen.getByRole('menu')).toBeTruthy() })
    expect(screen.getByText('切换书籍')).toBeTruthy()
    expect(screen.getByText('第二本书')).toBeTruthy()
  })

  it('点菜单里的另一本书 ⇒ 换过去并关菜单', async () => {
    const toc = vi.fn(async () => [
      { name: '甲章', url: 'u1' }, { name: '乙章', url: 'u2' },
    ])
    const chapter = vi.fn(async (_s: string, url: string) => ({ kind: 'text' as const, text: '正文 of ' + url }))
    const api2 = {
      ...fakeApi({ shelf: vi.fn(async () => [book(), book({ bookKey: 'https://ex.com/b2', title: '第二本书' })]) }),
      toc,
      chapter,
    } as unknown as NovelApi
    render(<NovelWidget api={api2} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: '打开阅读挂件' })).toBeTruthy() })
    const bubble = screen.getByRole('button', { name: '打开阅读挂件' })
    act(() => {
      bubble.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }))
    })
    await waitFor(() => { expect(screen.getByText('第二本书')).toBeTruthy() })
    await userEvent.click(screen.getByText('第二本书'))
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
  })

  it('按 Esc 关掉菜单', async () => {
    render(<NovelWidget api={fakeApi()} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: '打开阅读挂件' })).toBeTruthy() })
    const bubble = screen.getByRole('button', { name: '打开阅读挂件' })
    act(() => {
      bubble.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 }))
    })
    await waitFor(() => { expect(screen.getByRole('menu')).toBeTruthy() })
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull() })
  })
})

/**
 * 书架对账：在小说面板里删掉书之后，挂件必须能自己跟上。
 *
 * 旧实现只在挂载时读一次书架，而且「自动打开」那条判断只在还没选中书时成立——
 * 删掉正在读的那本之后，会话还拿着这本不存在的书，既不会换书也不回落，
 * 取章一路失败；错误屏的「重试」又只重读书架、不对账，成了死循环。
 */
describe('书架对账（删书之后）', () => {
  const A = book({ bookKey: 'https://ex.com/a', title: '甲书' })
  const B = book({ bookKey: 'https://ex.com/b', title: '乙书' })

  /** 书架内容可变：模拟「用户在别处删了一本」 */
  function mutableShelf(initial: ShelfEntry[]) {
    let current = initial
    const shelf = vi.fn(async () => current)
    return { shelf, set: (next: ShelfEntry[]) => { current = next } }
  }

  it('删掉正在读的那本 ⇒ 自动换到架上剩下的那本', async () => {
    const m = mutableShelf([A, B])
    const toc = vi.fn(async () => tocOf(3))
    const api = fakeApi({ shelf: m.shelf, toc })
    render(<NovelWidget api={api} />)
    await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
    await waitFor(() => { expect(screen.getByText('第一段0')).toBeTruthy() })
    // 打开时续上的是架上第一本（甲书）
    expect(toc).toHaveBeenLastCalledWith('s1', A.bookKey)

    // 用户在小说面板里删掉甲书
    m.set([B])
    // 挂件收起再叫出来（删完之后用户一定会经过的那一刻）
    await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
    await waitFor(() => { expect(screen.queryByText('第一段0')).toBeNull() })
    await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
    await waitFor(() => { expect(toc).toHaveBeenLastCalledWith('s1', B.bookKey) })
  })

  it('删光书架 ⇒ 回落选书屏的空态，而不是抱着已删的书', async () => {
    const m = mutableShelf([A])
    const api = fakeApi({ shelf: m.shelf })
    render(<NovelWidget api={api} />)
    await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
    await waitFor(() => { expect(screen.getByText('第一段0')).toBeTruthy() })

    m.set([])
    await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
    await waitFor(() => { expect(screen.queryByText('第一段0')).toBeNull() })
    await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
    await waitFor(() => { expect(screen.getByText('书架是空的')).toBeTruthy() })
  })

  it('书还在架上 ⇒ 刷新不打断正在读的位置', async () => {
    const m = mutableShelf([A])
    const toc = vi.fn(async () => tocOf(3))
    const api = fakeApi({ shelf: m.shelf, toc })
    render(<NovelWidget api={api} />)
    await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
    await waitFor(() => { expect(screen.getByText('第一段0')).toBeTruthy() })
    const callsAfterFirstOpen = toc.mock.calls.length

    // 书架没变，重新叫出来
    await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
    await waitFor(() => { expect(screen.queryByText('第一段0')).toBeNull() })
    await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
    await waitFor(() => { expect(screen.getByText('第一段0')).toBeTruthy() })
    // 没有重新取目录：仍在架就不动它，阅读位置不被打断
    expect(toc.mock.calls.length).toBe(callsAfterFirstOpen)
  })

  /**
   * 旧实现的死循环现场：正在读的那本已被删除 ⇒ 取目录失败 ⇒ 错误屏；
   * 旧「重试」只重读书架、不对账，于是永远抱着那本已删的书再失败一次。
   */
  it('错误屏的「重试」会对账并换到还在架上的书', async () => {
    const m = mutableShelf([A, B])
    const toc = vi.fn(async (_s: string, bookKey: string) => {
      if (bookKey === A.bookKey) throw new NovelApiError('failed', 'NotFound', '书没了', '书没了')
      return tocOf(3)
    })
    const api = fakeApi({ shelf: m.shelf, toc })
    render(<NovelWidget api={api} />)
    await userEvent.click(screen.getByRole('button', { name: '打开阅读挂件' }))
    // 甲书取目录失败 ⇒ 错误屏（此时它确实还在架上，所以不对账）
    await waitFor(() => { expect(screen.getByText('重试')).toBeTruthy() })

    // 用户在小说面板里把甲书删掉，然后点重试
    m.set([B])
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => { expect(toc).toHaveBeenLastCalledWith('s1', B.bookKey) }, { timeout: 3000 })
    await waitFor(() => { expect(screen.getByText('第一段0')).toBeTruthy() })
  })
})
