/**
 * HTTP 客户端的信封解包与错误分类（假 fetch 驱动，不联网）。
 * 这里钉的是「哪种失败说哪种话」——折叠成一句「出错了」会让用户永远找不到原因。
 */
import { describe, expect, it } from 'vitest'
import { createApi, NovelApiError } from '../src/client/api.js'

function jsonResponse(body: unknown, status = 200): Response {
  return {
    status,
    json: async () => body,
  } as unknown as Response
}

function apiWith(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  return createApi({ fetch: handler, timeoutMs: 50 })
}

describe('novel api', () => {
  it('成功信封解出 value', async () => {
    const api = apiWith(async () => jsonResponse({ ok: true, value: [{ bookKey: 'k', title: 't' }] }))
    await expect(api.shelf()).resolves.toEqual([{ bookKey: 'k', title: 't' }])
  })

  it('失败信封抛 failed，带 code 与 message', async () => {
    const api = apiWith(async () => jsonResponse({ ok: false, error: { code: 'NotFound', message: '源不存在' } }, 404))
    const err = await api.shelf().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NovelApiError)
    expect((err as NovelApiError).kind).toBe('failed')
    expect((err as NovelApiError).code).toBe('NotFound')
    expect((err as NovelApiError).display).toBe('源不存在')
  })

  it('路由根本不在（404 且非信封）⇒ unavailable，而不是 failed', async () => {
    const api = apiWith(async () => ({ status: 404, json: async () => { throw new Error('html') } } as unknown as Response))
    const err = await api.shelf().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NovelApiError)
    expect((err as NovelApiError).kind).toBe('unavailable')
  })

  it('网络层抛错 ⇒ failed/Network', async () => {
    const api = apiWith(async () => { throw new Error('ECONNREFUSED') })
    const err = await api.shelf().catch((e: unknown) => e)
    expect((err as NovelApiError).kind).toBe('failed')
    expect((err as NovelApiError).code).toBe('Network')
  })

  it('非 JSON 响应 ⇒ BadResponse', async () => {
    const api = apiWith(async () => ({ status: 200, json: async () => { throw new Error('nope') } } as unknown as Response))
    const err = await api.shelf().catch((e: unknown) => e)
    expect((err as NovelApiError).code).toBe('BadResponse')
  })

  it('信封形状不对也算失败，不当成空结果', async () => {
    const api = apiWith(async () => jsonResponse({ hello: 'world' }))
    const err = await api.shelf().catch((e: unknown) => e)
    expect((err as NovelApiError).code).toBe('BadEnvelope')
  })

  it('chapter 透传 kind:text', async () => {
    const api = apiWith(async () => jsonResponse({ ok: true, value: { kind: 'text', text: '正文' } }))
    await expect(api.chapter('s', 'u', 3)).resolves.toEqual({ kind: 'text', text: '正文' })
  })

  it('toc 拿到非数组时给空表（不猜内容）', async () => {
    const api = apiWith(async () => jsonResponse({ ok: true, value: null }))
    await expect(api.toc('s', 'u')).resolves.toEqual([])
  })

  it('存进度用 PUT + JSON body，路径里的 bookKey 整段编码', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const api = apiWith(async (url, init) => {
      calls.push({ url, init })
      return jsonResponse({ ok: true, value: { bookKey: 'https://x/y' } })
    })
    await api.saveProgress('https://www.sudugu.cc/2304/', 306, 0.25)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('/novel-api/shelf/https%3A%2F%2Fwww.sudugu.cc%2F2304%2F')
    expect(calls[0]!.init?.method).toBe('PUT')
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ progress: { chapterIndex: 306, offsetRatio: 0.25 } })
  })

  it('超时算 failed/Timeout', async () => {
    const api = createApi({
      fetch: (_url, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('aborted')
          e.name = 'AbortError'
          reject(e)
        })
      }),
      timeoutMs: 10,
    })
    const err = await api.shelf().catch((e: unknown) => e)
    expect((err as NovelApiError).code).toBe('Timeout')
  })
})
