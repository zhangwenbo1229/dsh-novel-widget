/**
 * 持久层与 store 之间的桥：localStorage 的读写、变更广播、以及「同一个标签页内
 * 自己写入也要通知订阅者」（storage 事件只在**别的**标签页触发，靠它自己收不到）。
 *
 * 单独一层是为了可测：单测可以塞一个假 storage（`Pick<Storage, ...>`），
 * 不必造 jsdom 全局。
 */

import { DEFAULT_PERSISTED, loadPersisted, savePersisted, type Persisted } from './prefs.js'

type StorageLike = Pick<Storage, 'getItem'> & Partial<Pick<Storage, 'setItem'>>

let storage: StorageLike | null = null
let current: Persisted = DEFAULT_PERSISTED
const listeners = new Set<() => void>()

/** 绑定存储（浏览器半在入口调一次；测试塞假体） */
export function bindStorage(next: StorageLike | null): void {
  storage = next
  current = loadPersisted(next === null ? null : { getItem: (k) => next.getItem(k) })
  for (const l of listeners) l()
}

export function getPersisted(): Persisted {
  return current
}

/** 改持久层：先改内存（订阅者立刻看到），再落盘（存不下不影响内存态） */
export function setPersisted(update: (p: Persisted) => Persisted): void {
  const next = update(current)
  if (next === current) return
  current = next
  savePersisted(storage === null ? null : { setItem: (k, v) => storage!.setItem?.(k, v) }, next)
  for (const l of listeners) l()
}

export function subscribePersisted(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** 测试用：把桥重置到缺省态 */
export function resetPersistedForTest(next?: Persisted): void {
  current = next ?? DEFAULT_PERSISTED
  storage = null
  for (const l of listeners) l()
}
