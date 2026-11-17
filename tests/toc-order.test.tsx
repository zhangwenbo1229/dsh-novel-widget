// @vitest-environment jsdom
/**
 * 目录抽屉的正序 / 倒序。
 *
 * 两件必须钉住的事：
 * 1. **两级下标不许混**：陈列行号变了，`onJump` 拿到的仍必须是**书内章号**——
 *    否则倒序时点「第 3 章」会跳到倒数第 3 章。
 * 2. **当前章高亮不随顺序漂**：它认的是章号，不是行号。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { TocDrawer, chapterToDisplay, displayToChapter, type TocOrder } from '../src/client/views/TocDrawer.js'
import type { ChapterEntry } from '../src/client/wire.js'

const toc: ChapterEntry[] = Array.from({ length: 8 }, (_, i) => ({
  name: `第${i + 1}章`,
  url: `https://ex.com/${i}`,
}))

/** 受控外壳：顺序真的会翻转（与 Shell 里 `prefs.tocDescending` 的接法一致） */
function Harness({ current = 2, onJump = () => {} }: { current?: number; onJump?: (i: number) => void }): ReactNode {
  const [order, setOrder] = useState<TocOrder>('asc')
  return (
    <TocDrawer
      toc={toc}
      current={current}
      order={order}
      onRefresh={async () => 'ok'}
      onToggleOrder={() => setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))}
      onJump={onJump}
      onClose={() => {}}
    />
  )
}

describe('目录下标映射', () => {
  it('正序时行号就是章号', () => {
    expect(displayToChapter(0, 8, 'asc')).toBe(0)
    expect(displayToChapter(7, 8, 'asc')).toBe(7)
    expect(chapterToDisplay(3, 8, 'asc')).toBe(3)
  })

  it('倒序时互为镜像', () => {
    expect(displayToChapter(0, 8, 'desc')).toBe(7)   // 第一行 = 最后一章
    expect(displayToChapter(7, 8, 'desc')).toBe(0)
    expect(chapterToDisplay(7, 8, 'desc')).toBe(0)
    expect(chapterToDisplay(0, 8, 'desc')).toBe(7)
  })

  it('两个方向都互逆', () => {
    for (const order of ['asc', 'desc'] as const) {
      for (let c = 0; c < 8; c += 1) {
        expect(displayToChapter(chapterToDisplay(c, 8, order), 8, order)).toBe(c)
      }
    }
  })
})

describe('目录抽屉的正序/倒序', () => {
  it('默认正序：第一行是第 1 章，按钮显示「正序」', () => {
    render(<Harness />)
    const items = screen.getAllByRole('button').filter((b) => b.className.includes('dnw-toc-item'))
    expect(items[0]?.textContent).toBe('第1章')
    expect(screen.getByRole('button', { name: '切换目录顺序' }).textContent).toBe('正序')
  })

  it('点一次切到倒序：第一行变成最后一章', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: '切换目录顺序' }))
    const items = screen.getAllByRole('button').filter((b) => b.className.includes('dnw-toc-item'))
    expect(items[0]?.textContent).toBe('第8章')
    expect(screen.getByRole('button', { name: '切换目录顺序' }).textContent).toBe('倒序')
    expect(screen.getByRole('button', { name: '切换目录顺序' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('倒序时点某一章，跳的仍是它自己的章号', async () => {
    const onJump = vi.fn()
    render(<Harness onJump={onJump} />)
    await userEvent.click(screen.getByRole('button', { name: '切换目录顺序' }))
    await userEvent.click(screen.getByRole('button', { name: '第3章' }))
    // 第 3 章的章号是 2（0 基），倒序只是它在列表里靠后
    expect(onJump).toHaveBeenCalledWith(2)
  })

  it('倒序时「最后一章」在第一行，点它跳的是末章', async () => {
    const onJump = vi.fn()
    render(<Harness onJump={onJump} />)
    await userEvent.click(screen.getByRole('button', { name: '切换目录顺序' }))
    await userEvent.click(screen.getByRole('button', { name: '第8章' }))
    expect(onJump).toHaveBeenCalledWith(7)
  })

  it('当前章高亮认章号，不随顺序漂', async () => {
    render(<Harness current={2} />)
    // 正序：第 3 章高亮
    expect(screen.getByRole('button', { name: '第3章' }).getAttribute('aria-current')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: '切换目录顺序' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '第3章' }).getAttribute('aria-current')).toBe('true')
    })
    // 其他行不该被标成当前
    expect(screen.getByRole('button', { name: '第8章' }).getAttribute('aria-current')).toBeNull()
  })

  it('只有一章时不显示顺序开关（没有可翻的东西）', () => {
    render(
      <TocDrawer
        toc={[toc[0]!]}
        current={0}
        order="asc"
        onRefresh={async () => 'ok'}
        onToggleOrder={() => {}}
        onJump={() => {}}
        onClose={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: '切换目录顺序' })).toBeNull()
  })

  /**
   * 切换顺序之后的落位（两条规则）。
   * 这是真机里发现的问题：从列表开头切到倒序时，「保住第 1 章在顶部」在倒序里
   * 只能滚到列表底部（第 1 章是最后一行），看起来像跳错了。
   */
  it('在列表开头切顺序 ⇒ 落在新顺序的开头', async () => {
    render(<Harness />)
    const el = document.querySelector('.dnw-toc') as HTMLElement
    el.scrollTop = 0            // 用户没浏览过，就停在开头
    await userEvent.click(screen.getByRole('button', { name: '切换目录顺序' }))
    expect(el.scrollTop).toBe(0)
  })

  it('滚到中间再切顺序 ⇒ 视口顶部那一章仍留在顶部', async () => {
    render(<Harness />)
    const el = document.querySelector('.dnw-toc') as HTMLElement
    el.scrollTop = 128          // 第 5 行 → 章号 4
    await userEvent.click(screen.getByRole('button', { name: '切换目录顺序' }))
    // 倒序里章号 4 在第 3 行（8 章，7-4=3）→ 3*32
    expect(el.scrollTop).toBe(96)
  })
})

describe('目录刷新的入口', () => {
  it('右上角有刷新按钮，点它去取新目录并把结果说给人听', async () => {
    const onRefresh = vi.fn(async () => '新增 3 章')
    render(
      <TocDrawer
        toc={toc}
        current={0}
        order="asc"
        onToggleOrder={() => {}}
        onRefresh={onRefresh}
        onJump={() => {}}
        onClose={() => {}}
      />,
    )
    const btn = screen.getByRole('button', { name: '刷新目录' })
    await userEvent.click(btn)
    expect(onRefresh).toHaveBeenCalledTimes(1)
    // 结果作为回执上屏（role=status，读屏也会播报）
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('新增 3 章') })
  })

  it('刷新中按钮禁用，避免连点打出一串请求', async () => {
    let release!: (v: string) => void
    const onRefresh = vi.fn(() => new Promise<string>((r) => { release = r }))
    render(
      <TocDrawer
        toc={toc}
        current={0}
        order="asc"
        onToggleOrder={() => {}}
        onRefresh={onRefresh}
        onJump={() => {}}
        onClose={() => {}}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: '刷新目录' }))
    // 进行中：还在场，但已禁用，文案变成「刷新中…」
    const running = screen.getByRole('button', { name: '刷新目录' }) as HTMLButtonElement
    expect(running.disabled).toBe(true)
    expect(running.getAttribute('aria-busy')).toBe('true')
    await userEvent.click(running)
    expect(onRefresh).toHaveBeenCalledTimes(1)   // 连点没生效
    release('已是最新')
    await waitFor(() => { expect(screen.getByRole('status').textContent).toBe('已是最新') })
  })
})
