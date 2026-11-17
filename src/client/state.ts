/**
 * 挂件的模块级现场（跨卸载不丢）。
 *
 * 为什么不住 React state：宿主 `shell.overlay` 与 `main` 是不同子树，面板切换会让
 * 「开关挂件」的按钮与浮窗本体分别挂载/卸载；把开合与几何放进组件 state，一卸载就归零。
 * 所以现场住模块级 store（dsh-novel 的 `client/store.ts` 同一手法），组件只做它的投影。
 *
 * 它**不持有业务真相**：书、章、正文永远从 `/novel-api` 现读，这里只留「读哪本、读没读、
 * 窗口在哪」这类交互现场。
 */

import { getPersisted, setPersisted, subscribePersisted } from './persist-bridge.js'

export interface WidgetState {
  open: boolean
  /** 展开中是否处于「气泡收起」状态（open=true 且 collapsed=true 表示只留标题条） */
  collapsed: boolean
  prefs: import('./prefs.js').Prefs
  geometry: import('./prefs.js').Geometry
  bubble: { x: number; y: number; side: 'left' | 'right' | 'top' | 'bottom' | null }
}

type Listener = () => void

const listeners = new Set<Listener>()

function snapshot(): WidgetState {
  const p = getPersisted()
  return {
    open: p.open,
    collapsed: collapsed,
    prefs: p.prefs,
    geometry: p.geometry,
    bubble: p.bubble,
  }
}

/** 「只留标题条」是纯瞬时态（不落盘）：它属于「这一刻看见什么」，不属于「下次回来什么样」 */
let collapsed = false

let cached: WidgetState = snapshot()

function emit(): void {
  cached = snapshot()
  for (const l of listeners) l()
}

/** useSyncExternalStore 的取快照：必须返回稳定引用（值没变就不许造新对象） */
export function getState(): WidgetState {
  return cached
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  if (listeners.size === 1) {
    // 第一次有人订阅时挂上持久层的变更广播（本地 storage 事件与自身写入都走它）
    unsubscribePersist = subscribePersisted(emit)
  }
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && unsubscribePersist !== null) {
      unsubscribePersist()
      unsubscribePersist = null
    }
  }
}

let unsubscribePersist: (() => void) | null = null

// ── 动作（调用方只调这些，不直接改持久层）──────────────────────────────

export function setOpen(open: boolean): void {
  setPersisted((p) => ({ ...p, open }))
  if (open) collapsed = false
  emit()
}

export function toggleOpen(): void {
  setOpen(!getPersisted().open)
}

export function setCollapsed(value: boolean): void {
  if (collapsed === value) return
  collapsed = value
  emit()
}

export function setPrefs(patch: Partial<import('./prefs.js').Prefs>): void {
  setPersisted((p) => ({ ...p, prefs: { ...p.prefs, ...patch } }))
}

export function setGeometry(g: import('./prefs.js').Geometry): void {
  setPersisted((p) => ({ ...p, geometry: g }))
}

export function setBubble(b: { x: number; y: number; side: 'left' | 'right' | 'top' | 'bottom' | null }): void {
  setPersisted((p) => ({ ...p, bubble: b }))
}

export function setLastBookKey(key: string | null): void {
  setPersisted((p) => ({ ...p, lastBookKey: key }))
}

export function getLastBookKey(): string | null {
  return getPersisted().lastBookKey
}
