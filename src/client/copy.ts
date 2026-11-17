/**
 * 界面文案单点（中文原文只住这里）。
 *
 * v1 只做中文，但**文案不许散进组件**：散进去之后加英文时要在十几个文件里翻字符串，
 * 一定会漏。所以现在就把它们收成一张表，加 i18n 时只需给这张表配一份英文镜像。
 *
 * 例外（可以不出现在这里，且必须与语言无关）：单位（章 / %）、格式名、错误码、
 * 装饰字形（·、→、✕）。
 */

export const ZH = {
  // ── 入口与外壳 ────────────────────────────────────────────────
  'bubble.open': '打开阅读挂件',
  'bubble.close': '收起阅读挂件',
  'bubble.badge': '读',
  'shell.title': '随手读',
  'shell.collapse': '只留标题条',
  'shell.expand': '展开',
  'shell.close': '关闭挂件',
  'shell.drag': '拖动浮窗',
  'shell.resize': '调整大小',

  // ── 选书 ──────────────────────────────────────────────────────
  'pick.title': '书架上的书',
  'pick.empty.title': '书架是空的',
  'pick.empty.hint': '先在「小说」面板里找一本加进书架，这里就会列出来。',
  'pick.noLocation': '（暂无来源信息）',
  'pick.continue': '继续读',
  'pick.choose': '换一本',
  'pick.progressAt': '第 {n} 章',
  'pick.unread': '未开始',
  'pick.loading': '正在读书架…',
  'pick.failed': '读书架失败',

  // ── 右键菜单 ──────────────────────────────────────────────────
  'menu.title': '切换书籍',
  'menu.hint': '右键气泡换书',

  // ── 阅读 ──────────────────────────────────────────────────────
  'read.loading': '正在取第 {n} 章…',
  'read.failed': '这一章没取到',
  'read.retry': '重试',
  'read.prev': '上一章',
  'read.next': '下一章',
  'read.chapterOf': '第 {n} / {total} 章',
  'read.noMore': '已经是最后一章',
  'read.atStart': '已经是第一章',
  'read.richUnsupported': '这是图文（EPUB）章节，本挂件只支持纯文字书',
  'read.expand': '展开全文',
  'read.collapse': '收起气泡',
  'read.tocFailed': '目录没取到，暂时不能跳章',

  // ── 目录 ──────────────────────────────────────────────────────
  'toc.title': '目录',
  'toc.jump': '跳到此章',
  'toc.current': '当前章',
  'toc.close': '关闭目录',
  'toc.empty': '这本书还没有目录',
  'toc.count': '共 {n} 章',
  // 目录陈列顺序（只影响列表怎么排，不影响阅读顺序）
  'toc.order.asc': '正序',
  'toc.order.desc': '倒序',
  'toc.order.toggle': '切换目录顺序',
  'toc.order.toDesc': '改为倒序（最新章在前）',
  'toc.order.toAsc': '改为正序（第 1 章在前）',
  // 刷新目录（源站更新了书籍：补章 / 改章）
  'toc.refresh': '刷新目录',
  'toc.refresh.hint': '去源站重新拉取目录（适用于源站刚补了新章）',
  'toc.refresh.running': '刷新中…',
  'toc.refresh.ok': '已更新，共 {n} 章',
  'toc.refresh.added': '新增 {n} 章',
  'toc.refresh.none': '已是最新',
  'toc.refresh.moved': '原章节在源站已找不到，已停在最接近的位置',
  'toc.refresh.noBook': '还没有在读书籍',
  'toc.refresh.cancelled': '书籍已切换，本次刷新作废',
  'toc.refresh.empty': '源站没返回目录，保留原目录',
  'toc.refresh.failed': '刷新失败',

  // ── 设置 ──────────────────────────────────────────────────────
  'prefs.title': '阅读设置',
  'prefs.font': '字号',
  'prefs.lineHeight': '行距',
  'prefs.measure': '栏宽',
  'prefs.smaller': '缩小',
  'prefs.larger': '放大',
  'prefs.close': '关闭设置',

  // ── 错误 ──────────────────────────────────────────────────────
  'err.unavailable': '没连上小说插件。请确认已安装并启用了 dsh-novel。',
  'err.offline': '连不上本机服务，稍后再试。',
  'err.notOnShelf': '这本书已经不在书架上了。',
  'err.generic': '出错了：{msg}',
  'err.progressSave': '进度没存上（不影响继续读）',

  // ── 单位与计数 ────────────────────────────────────────────────
  'unit.chapter': '章',
} as const

export type CopyKey = keyof typeof ZH

/** 取词单点：带 `{name}` 占位替换。缺键在开发期直接抛（宁可炸也不静默出空串）。 */
export function t(key: CopyKey, vars?: Record<string, string | number>): string {
  const raw: string = ZH[key]
  if (vars === undefined) return raw
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = vars[name]
    return v === undefined ? whole : String(v)
  })
}
