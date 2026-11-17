/**
 * 浏览器半入口：把「随手读」挂进宿主的 `shell.overlay`。
 *
 * 为什么是 `shell.overlay`（而不是侧栏/中央面板）：
 * 宿主对该槽的 catalog 原文写的是「Frame-wide floating layer, above every column and
 * outside their scroll containers … This is the additive seat for a frame-wide surface
 * of your own」，且它是 root 作用域、list 基数——**切面板与切会话都不卸载它**。
 * 这正是「挂件」的定义：任何界面之上都在，且不跟任何会话绑定。
 *
 * 它同时是**点击穿透**的：层本身不吃事件，所以浮窗与气泡各自显式开 `pointer-events`，
 * 其余区域照旧是下面的界面，不会挡路。
 *
 * 注册一个 id 我们自己的条目（`novel-widget`），不与宿主已占的 `novel-status`
 * （dsh-novel 自己的常驻状态条）抢格子。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
import { WidgetStyles } from './styles.js'
import { NovelWidget } from './views/NovelWidget.js'

export const inject = ['slots']

export function apply(ctx: Context): void {
  const slots = (ctx as unknown as {
    slots: {
      inject(name: string, fn: () => () => void): () => void
      register(options: Record<string, unknown>, component: unknown): () => void
    }
  }).slots

  ctx.effect(() => slots.inject('shell.overlay', () => slots.register(
    {
      name: 'shell.overlay',
      id: 'novel-widget',
      // 排在 dsh-novel 自己的状态条（order 100）之后：任务提示该在阅读窗之上
      order: 200,
      label: () => '随手读',
    },
    NovelOverlay,
  )), 'dsh-novel-widget: shell overlay')
}

/** 槽位占用者：挂件本体 + 它的样式层（独立挂载点必须自带样式，见 styles.tsx） */
function NovelOverlay(): ReactNode {
  return (
    <div data-dnw-scope="">
      <WidgetStyles />
      <NovelWidget />
    </div>
  )
}

export { NovelWidget }
