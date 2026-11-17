/**
 * 阅读窗口与预取判据（纯函数；视图只做渲染，不做这些判断）。
 *
 * 连续滚动流 = 一个**有序章号数组** + 每章正文。窗口不许无限增长：往上翻要能回看，
 * 往下翻要能提前备好，但两头都裁——否则读到第 300 章时 DOM 里躺着 300 章正文，
 * 这个挂件会先把宿主页面拖死。裁剪时保留当前章前后各 `KEEP_BEHIND` / `KEEP_AHEAD` 章。
 */

/** 窗口两侧各留多少章（当前章之外）。往上留得多一些：回看比前进更常见。 */
export const KEEP_BEHIND = 2
export const KEEP_AHEAD = 3

/** 窗口的连续章号区间 [first, last]（含端） */
export interface Window { first: number; last: number }

/** 首次进入某章时的窗口：前 2 后 3，夹在书的首尾之内 */
export function initialWindow(chapterIndex: number, total: number): Window {
  if (total <= 0) return { first: 0, last: -1 }
  const first = Math.max(0, chapterIndex - KEEP_BEHIND)
  const last = Math.min(total - 1, chapterIndex + KEEP_AHEAD)
  return { first, last }
}

/** 当前章变化后的新窗口；与旧窗口相同则返回**同一个对象引用**（视图据此跳过重排） */
export function windowFor(chapterIndex: number, total: number, prev: Window): Window {
  if (total <= 0) return prev.first === 0 && prev.last === -1 ? prev : { first: 0, last: -1 }
  const first = Math.max(0, chapterIndex - KEEP_BEHIND)
  const last = Math.min(total - 1, chapterIndex + KEEP_AHEAD)
  if (first === prev.first && last === prev.last) return prev
  return { first, last }
}

/** 窗口是否已含该章 */
export function windowHas(w: Window, chapterIndex: number): boolean {
  return chapterIndex >= w.first && chapterIndex <= w.last
}

/** 预取判据：距窗口底部剩余的内容不足 `thresholds` 屏时，该把窗口往后扩一章。
 *  `remainingPx` = 内容总高 − 已滚过 − 视口高（负值按 0 算）。 */
export function shouldPrefetch(remainingPx: number, viewportHeight: number, thresholds = 1.5): boolean {
  if (viewportHeight <= 0) return false
  return Math.max(0, remainingPx) < viewportHeight * thresholds
}

/** 窗口往后扩一章（已到底则原样返回同一引用） */
export function extendTail(w: Window, total: number, by = 1): Window {
  const last = Math.min(total - 1, w.last + by)
  return last === w.last ? w : { first: w.first, last }
}

/** 窗口往前扩一章（已到顶则原样返回同一引用） */
export function extendHead(w: Window, by = 1): Window {
  const first = Math.max(0, w.first - by)
  return first === w.first ? w : { first, last: w.last }
}

/** 裁窗口：保留 [chapterIndex-KEEP_BEHIND, chapterIndex+KEEP_AHEAD]，且不越过书的首尾。
 *  返回被裁掉的章号集合——视图据此清掉对应正文缓存（不清理就会内存泄漏）。 */
export function trimWindow(w: Window, chapterIndex: number, total: number): { window: Window; dropped: number[] } {
  const keepFirst = Math.max(0, chapterIndex - KEEP_BEHIND)
  const keepLast = Math.min(total - 1, chapterIndex + KEEP_AHEAD)
  const dropped: number[] = []
  for (let i = w.first; i <= w.last; i += 1) {
    if (i < keepFirst || i > keepLast) dropped.push(i)
  }
  if (dropped.length === 0) return { window: w, dropped }
  return { window: { first: Math.max(w.first, keepFirst), last: Math.min(w.last, keepLast) }, dropped }
}

/** 纯文字章 → 段落数组（保留空行结构；`\r\n` 归一）。
 *  正文里连续空行折叠成一个空段，避免站点用十几个 `<br>` 撑出来的空洞把滚动条拉长。 */
export function toParagraphs(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim())
  const out: string[] = []
  let blank = false
  for (const line of lines) {
    if (line === '') {
      if (!blank && out.length > 0) out.push('')
      blank = true
      continue
    }
    blank = false
    out.push(line)
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out
}
