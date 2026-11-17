/**
 * Node 半入口：一个**什么也不做**的 cordis 插件。
 *
 * 为什么还要有这一半：宿主挂一条插件行（`cordis.patch.yml` 的 insert）时，会 import 本包
 * 的 `main` 并当 cordis 插件挂载——缺了这个模块，整棵插件树在装载期就失败
 * （`plugin tree failed to load`），浏览器半也就没有机会进场。
 *
 * 它刻意什么都不注册：
 * - 不注册路由（数据全部读 dsh-novel 的 `/novel-api`，同源 fetch，不需要自己的服务端）；
 * - 不注册工具（挂件是给人看的，不是给模型调的；用户没要求 AI 面）；
 * - 不注册配置项（偏好住浏览器 localStorage，见 `client/prefs.ts` 头注）。
 *
 * 加能力的判据：**只有当浏览器半拿不到、必须服务端去取时才加**。否则这一半就该一直空着。
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = '@xrn1997/dsh-novel-widget'

/** 无依赖：不 inject 任何宿主服务，所以任何 profile 都能挂上它 */
export const inject: string[] = []

export function apply(_ctx: Context): void {
  // 有意留空——见文件头注
}
