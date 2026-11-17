/**
 * 阅读进度的像素 ⇄ 比例数学（纯函数；本挂件正确性的中枢）。
 *
 * **跨度口径 = 该章自己的渲染高度**。存（`locateChapter`）与取（`anchorTop`）用同一个跨度，
 * 于是两者互逆。这不是新发明的口径——dsh-novel 主面板的 `src/client/progress.ts` 头注写明了
 * 它踩过的坑：存侧借「到下一章的距离」（尾章没有 next ⇒ 比例恒 0，而尾章恰恰是用户正读的那章）、
 * 取侧借「内容剩余高度」，同一个比例两边算出不同像素。本挂件要跟主面板共用 `shelf.json` 里的
 * 同一个 `offsetRatio`，所以必须按同一口径算，否则两边一换就跳位。
 *
 * 为什么抄一份而不 import：跨插件值 import 被两边的构建期纯度门拒绝（见 `wire.ts` 头注）。
 * 互逆性由 `tests/progress.test.ts` 守。
 */

export interface ChapterAnchor {
  index: number
  /** 该章起点在滚动容器内容坐标里的位置（px） */
  start: number
  /** 该章的渲染高度（px）；未量到 → 0 */
  height: number
}

/** 章内比例：`scrollTop` 在锚点 [start, start+height] 内的占比，夹在 0..1；高度没量到 → 0。
 *  存侧与「落位后回读真实比例」共用它（同一个比例两处各写一遍就会算出两个数）。 */
export function ratioWithin(a: ChapterAnchor, scrollTop: number): number {
  return a.height > 0 ? Math.min(1, Math.max(0, (scrollTop - a.start) / a.height)) : 0
}

/** 起点与「当前滚动位」的容差（px）。
 *
 *  落位会把 scrollTop **精确**设到某章的起点，而滚动偏移是小数：再拿同一个位置反查章号时，
 * 差之毫厘就会归给**上一章的末尾**（比例被夹成 1）——那是完全不同的位置。留 1px 容差，
 *  让「正好在某章起点」稳定地算作「就在这一章的开头」。 */
const START_EPS = 1

/**
 * 定位当前章与章内比例：取起点不晚于滚动位的**最大**可信锚点。
 *
 * 可信 = 到它为止**前面每一章都量到了高度**。零高度的章意味着那一章还没渲染出来，
 * 而它的高度缺席会让其后所有锚点的 `start` 都不对——两者的起点会撞在同一个数上。
 * 所以走到第一个未测章就停，后面的锚点一律不参选。
 *
 * **一个都不可信时返回 `null`，而不是猜「窗口第一章」**。这条是踩过坑写下的：
 * 跳转的瞬间整屏都是「加载中」占位（高度接近 0），拿这种布局去定位，会把用户刚点的
 * 目标章悄悄改写成窗口里那一章——表现为「点了第 21 章却跳到第 18 章」，而且之后
 * 每次上一章/下一章都在这个错误位置上继续漂。说不准的时候什么都不说，比说错好。
 */
export function locateChapter(
  anchors: ChapterAnchor[],
  scrollTop: number,
): { chapterIndex: number; offsetRatio: number } | null {
  if (anchors.length === 0) return null
  let hit: ChapterAnchor | null = null
  for (const a of anchors) {
    if (a.height <= 0) break
    if (a.start > scrollTop + START_EPS) break
    hit = a
  }
  if (hit === null) return null
  return { chapterIndex: hit.index, offsetRatio: ratioWithin(hit, scrollTop) }
}

/** 恢复定位反函数：章 + 比例 → scrollTop（夹在可滚动范围内，不许越过内容底）。
 *  chapterIndex 不在已测锚点里（越界/未载）→ null，由调用方决定「先加载那一章再落位」。 */
export function anchorTop(
  anchors: ChapterAnchor[],
  chapterIndex: number,
  offsetRatio: number,
  scrollHeight: number,
  clientHeight: number,
): number | null {
  const a = anchors.find((x) => x.index === chapterIndex)
  if (a === undefined) return null
  const raw = a.start + Math.min(1, Math.max(0, offsetRatio)) * a.height
  return Math.min(Math.max(0, scrollHeight - clientHeight), Math.max(0, raw))
}

/**
 * 由各章实测高度拼出锚点表。`heights` 以「窗口内的章序」给出，`firstIndex` 是窗口首章的书内章号。
 * 高度缺席（还没量到）的章按 0 计——0 高度的章不会成为任何滚动位的「当前章」，
 * 这正是想要的：还没渲染出来的章不该抢走进度归属。
 */
export function buildAnchors(firstIndex: number, heights: number[]): ChapterAnchor[] {
  const out: ChapterAnchor[] = []
  let cursor = 0
  for (let i = 0; i < heights.length; i += 1) {
    const h = Number.isFinite(heights[i]) && heights[i]! > 0 ? heights[i]! : 0
    out.push({ index: firstIndex + i, start: cursor, height: h })
    cursor += h
  }
  return out
}

/** 两个进度是否「实质相同」（避免同一位置反复写盘）。
 *  章不同 ⇒ 必不同；章相同则比例差小于 0.5% 视为同位置（滚动抖动不该产生写请求）。 */
export function samePlace(
  a: { chapterIndex: number; offsetRatio: number },
  b: { chapterIndex: number; offsetRatio: number },
): boolean {
  return a.chapterIndex === b.chapterIndex && Math.abs(a.offsetRatio - b.offsetRatio) < 0.005
}
