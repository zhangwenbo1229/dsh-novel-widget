/**
 * 样式表的**源码级**闸门。
 *
 * 为什么需要它：CSS 住在一个 JS 模板字符串里，所以 CSS **注释**里出现反引号或 `${`
 * 就会把模板提前截断/插值，表现为构建报 `PARSE_ERROR`（甚至 `lib/` 被清空后空转），
 * 而错误信息指向的是「某个中文注释」，看不出真正的原因。
 *
 * 这个坑在本仓已经踩过三次，每次都要重新定位一遍。于是把它变成一条会红的测试：
 * 只读源码文本、不 import（import 会在解析阶段就炸，报错反而更难读）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const file = join(import.meta.dirname, '..', 'src', 'client', 'styles.tsx')
const source = readFileSync(file, 'utf8')

describe('styles.tsx 的模板串完整性', () => {
  it('CSS 模板只有一个开引号与一个闭引号，且闭合处紧跟样式层函数', () => {
    const open = source.indexOf('const CSS = `')
    expect(open, '找不到 CSS 模板的开头').toBeGreaterThan(-1)
    // 模板的**开引号**：`const CSS = ` 之后那个
    const openTick = source.indexOf('`', open)
    expect(openTick).toBeGreaterThan(open)

    // 开引号之后还该有几个反引号？只能有 1 个（闭合）。多出来的一定在 CSS 注释里，
    // 那会把模板提前截断。
    const ticks: number[] = []
    for (let i = 0; i < source.length; i += 1) if (source[i] === '`') ticks.push(i)
    const afterOpen = ticks.filter((i) => i > openTick)
    expect(
      afterOpen.length,
      'CSS 模板内部出现了多余的反引号（注释里写的 `xxx` 会截断模板）',
    ).toBe(1)

    const close = afterOpen[0]!
    const tail = source.slice(close + 1).trimStart()
    expect(tail.startsWith('/**'), 'CSS 模板的闭合引号后面应紧跟样式层函数注释').toBe(true)
  })

  it('CSS 模板内部没有 ${ 插值（那是 JS，不是 CSS）', () => {
    const open = source.indexOf('const CSS = `')
    const close = source.indexOf('`', open + 1)
    const css = source.slice(open, close)
    expect(css.includes('${'), 'CSS 里出现了 ${ —— 会被当成 JS 插值').toBe(false)
  })
})
