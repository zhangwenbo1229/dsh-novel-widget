/**
 * 契约门：**真打本机的 dsh-novel `/novel-api`**，逐条核对 `wire.ts` 的镜像还对不对。
 *
 * 为什么需要它：`wire.ts` 是抄本，抄本会腐烂。默认测试集里所有用例都用假 fetch，
 * 它们只能证明「我们对形状的理解是自洽的」，不能证明「对面还是这个形状」。
 * 这一条是唯一能发现「dsh-novel 改了响应、挂件静默读空」的东西。
 *
 * 默认跳过（`DSH_NOVEL_CONTRACT=1` 才跑）：常规集会起不来——它要求宿主正在跑、
 * dsh-novel 已装、书架上有书。门控的用法：
 *
 *   $env:DSH_NOVEL_CONTRACT='1'
 *   $env:DSH_NOVEL_ORIGIN='http://127.0.0.1:12968'   # 可选，缺省就是这个
 *   pnpm test
 *
 * 它是**断言**不是报告：对面形状变了就该红。
 */
import { describe, expect, it } from 'vitest'
import { createApi, NovelApiError } from '../src/client/api.js'
import { routes, SEG, NOVEL_API_PREFIX } from '../src/client/wire.js'

const ENABLED = process.env['DSH_NOVEL_CONTRACT'] === '1'
const ORIGIN = process.env['DSH_NOVEL_ORIGIN'] ?? 'http://127.0.0.1:12968'

/** 把相对路径补成绝对（Node 的 fetch 不认相对路径；浏览器里同源天然成立） */
const absolute = (path: string): string => new URL(path, ORIGIN).toString()

describe.skipIf(!ENABLED)('dsh-novel 契约（真打本机）', () => {  const api = createApi({
    fetch: (input, init) => fetch(absolute(input), init),
    timeoutMs: 20_000,
  })

  it('前缀与路由段与对面一致', async () => {
    expect(NOVEL_API_PREFIX).toBe('/novel-api')
    // 健康检查路由在对面存在 ⇒ 前缀没错
    const res = await fetch(absolute(NOVEL_API_PREFIX))
    const body = await res.json() as { ok: boolean; value?: { name: string; apiVersion: number } }
    expect(body.ok).toBe(true)
    expect(body.value?.name).toBe('dsh-novel')
    expect(SEG.shelf).toBe('shelf')
    expect(routes.shelf()).toBe('/novel-api/shelf')
  })

  it('书架条目含本挂件消费的字段', async () => {
    const shelf = await api.shelf()
    expect(Array.isArray(shelf)).toBe(true)
    if (shelf.length === 0) {
      expect(shelf).toEqual([])
      return
    }
    const b = shelf[0]!
    expect(typeof b.sourceId).toBe('string')
    expect(typeof b.bookKey).toBe('string')
    expect(typeof b.title).toBe('string')
    expect(typeof b.progress.chapterIndex).toBe('number')
    expect(typeof b.progress.offsetRatio).toBe('number')
    // 投影字段：源已删 → null，不是缺席
    expect(b.sourceName === null || typeof b.sourceName === 'string').toBe(true)
  })

  it('目录是 [{name,url}]，下标即 chapterIndex', async () => {
    const shelf = await api.shelf()
    const book = shelf.find((b) => !b.bookKey.startsWith('local:'))
    if (book === undefined) return
    const toc = await api.toc(book.sourceId, book.bookKey)
    expect(Array.isArray(toc)).toBe(true)
    if (toc.length === 0) return
    expect(typeof toc[0]!.name).toBe('string')
    expect(typeof toc[0]!.url).toBe('string')
  })

  it('正文：能取到时是 kind:text 且非空；取不到时必须报业务失败（不许用空正文冒充成功）', async () => {
    const shelf = await api.shelf()
    const book = shelf.find((b) => !b.bookKey.startsWith('local:'))
    if (book === undefined) return
    try {
      const content = await api.chapter(book.sourceId, book.bookKey, Math.min(1, book.progress.chapterIndex))
      expect(content.kind).toBe('text')
      if (content.kind === 'text') expect(content.text.length).toBeGreaterThan(0)
    } catch (e) {
      // 站点取不到正文时 dsh-novel 的引擎会带段级定位报错。这是**契约的一部分**：
      // 取位失败必须是失败，不能折叠成空字符串——挂件据此才能说「这一章没取到」并给重试，
      // 而不是渲染一屏空白让人以为书就这么短。
      //
      // 为什么把这条写成「要么成功、要么业务失败」：这一门要验的是**形状**，
      // 不是「今天这个站能不能抓到」。若把它绑成「必须成功」，站点一抽风契约门就红，
      // 而红的原因跟挂件、跟契约都无关——门就从守卫退化成噪声源。
      expect(e).toBeInstanceOf(NovelApiError)
      expect((e as NovelApiError).kind).toBe('failed')
      expect((e as NovelApiError).code).not.toBe('')
    }
  })

  it('存进度真的写得进去（写回同一个值，读面能看见 updatedAt 推进）', async () => {
    const shelf = await api.shelf()
    const book = shelf[0]
    if (book === undefined) return
    const before = book.progress.updatedAt
    const saved = await api.saveProgress(book.bookKey, book.progress.chapterIndex, book.progress.offsetRatio)
    expect(saved.bookKey).toBe(book.bookKey)
    // 服务端会刷新 updatedAt（同一毫秒内可能相等，所以只断言单调不减）
    expect(saved.progress.updatedAt).toBeGreaterThanOrEqual(before)
  })

  it('未知书签名的章节报业务失败（不是空正文）', async () => {
    const err = await api.chapter('definitely-not-a-source', 'https://example.invalid/b', 0).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NovelApiError)
    expect((err as NovelApiError).kind).toBe('failed')
  })
  // 单条 30s：这一门会经 dsh-novel 真去站点抓目录与正文，慢站超过 vitest 缺省的 5s
  // 是网络现象、不是契约变化。超时会伪装成失败，所以把预算给足——要让这一门红的
  // 只有一种情况：形状或取值真的对不上了。
}, 30_000)
