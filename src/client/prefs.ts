/**
 * 阅读偏好（字号 / 行距 / 栏宽 / 纸色）与几何的持久化。
 *
 * 存 `localStorage` 而不是走服务端：这些是**本机这一块屏**的观感，跟用户在哪台机器、
 * 窗口多宽绑着，跨设备同步没有意义（dsh-novel 的阅读偏好同理住在浏览器侧）。
 *
 * 存储键带包名是为了与 dsh-novel 自己的偏好分开——两处各存各的，谁也不读对方的键。
 */

export const STORAGE_KEY = '@xrn1997/dsh-novel-widget'

/** 字号档位（px）：与 dsh-novel 主面板同一组数字，两处切来不觉得跳 */
export const FONT_STEPS = [12, 14, 16, 18, 20, 22, 24, 26, 28] as const
/** 行距档位（倍数） */
export const LINE_HEIGHTS = [1.4, 1.6, 1.8, 2.0] as const
/** 正文栏宽档位（em）：中文一行约 28–44 字 */
export const MEASURES = [28, 32, 36, 44] as const

export interface Prefs {
  fontPx: number
  lineHeight: number
  measureEm: number
  /**
   * 目录倒序（最新章排在前面）。
   *
   * **只影响目录的陈列，不影响阅读顺序**：连续滚动、上一章/下一章、进度章号
   * 一律仍按书内章号（第 1 章 → 第 N 章）。这是「列表怎么排」，不是「书怎么读」——
   * 把两者混起来，进度语义会跟着翻，`shelf.json` 里的章号就不再可比。
   */
  tocDescending: boolean
}

export const DEFAULT_PREFS: Prefs = { fontPx: 16, lineHeight: 1.8, measureEm: 36, tocDescending: false }

/** 浮窗几何：位置是左上角（px，视口坐标），尺寸含最小夹取 */
export interface Geometry {
  x: number
  y: number
  width: number
  height: number
}

export const MIN_WIDTH = 300
export const MIN_HEIGHT = 220
export const DEFAULT_GEOMETRY: Geometry = { x: -1, y: 80, width: 420, height: 560 }

/** 挂件的常驻现场：气泡位置、开合、上次读的书、偏好、几何 */
export interface Persisted {
  /** 气泡位置：`side` 是**吸附语义**（贴哪条边），x/y 是自由态的像素。
   *  吸附态下像素每次按视口现算，所以换窗口大小也照样贴着边（见 snap.ts）。 */
  bubble: { x: number; y: number; side: 'left' | 'right' | 'top' | 'bottom' | null }
  /** 上次读的书 bookKey（可能已下架；读出时校验） */
  lastBookKey: string | null
  prefs: Prefs
  geometry: Geometry
  /** 是否展开（关掉页面再回来保持上一次的样子） */
  open: boolean
}

export const DEFAULT_PERSISTED: Persisted = {
  bubble: { x: 24, y: 24, side: null },
  lastBookKey: null,
  prefs: DEFAULT_PREFS,
  geometry: DEFAULT_GEOMETRY,
  open: false,
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function finiteOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** 认不出的边一律当自由态（手改坏的 side 不该让气泡凭空跳边） */
function isBubbleSide(v: unknown): v is 'left' | 'right' | 'top' | 'bottom' {
  return v === 'left' || v === 'right' || v === 'top' || v === 'bottom'
}

/** 从任意 JSON 值归一化出一份可用的现场：**认不出的键丢掉、越界的数夹回**，
 *  绝不让一个手改坏的 localStorage 把挂件挡在门外（读不出来就用缺省，不是抛错）。 */
export function normalizePersisted(raw: unknown): Persisted {
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const bubble = (o.bubble !== null && typeof o.bubble === 'object' ? o.bubble : {}) as Record<string, unknown>
  const geo = (o.geometry !== null && typeof o.geometry === 'object' ? o.geometry : {}) as Record<string, unknown>
  const prefs = (o.prefs !== null && typeof o.prefs === 'object' ? o.prefs : {}) as Record<string, unknown>

  const fontPx = nearest(FONT_STEPS, finiteOr(prefs.fontPx, DEFAULT_PREFS.fontPx))
  const lineHeight = nearest(LINE_HEIGHTS, finiteOr(prefs.lineHeight, DEFAULT_PREFS.lineHeight))
  const measureEm = nearest(MEASURES, finiteOr(prefs.measureEm, DEFAULT_PREFS.measureEm))

  return {
    bubble: {
      x: Math.max(0, finiteOr(bubble.x, DEFAULT_PERSISTED.bubble.x)),
      y: Math.max(0, finiteOr(bubble.y, DEFAULT_PERSISTED.bubble.y)),
      side: isBubbleSide(bubble.side) ? bubble.side : null,
    },
    lastBookKey: typeof o.lastBookKey === 'string' && o.lastBookKey !== '' ? o.lastBookKey : null,
    prefs: {
      fontPx,
      lineHeight,
      measureEm,
      // 只认真正的 true；手改出来的 "true" 字符串、1 之类一律回落缺省（正序）
      tocDescending: prefs.tocDescending === true,
    },
    geometry: {
      x: finiteOr(geo.x, DEFAULT_GEOMETRY.x),
      y: finiteOr(geo.y, DEFAULT_GEOMETRY.y),
      width: Math.max(MIN_WIDTH, finiteOr(geo.width, DEFAULT_GEOMETRY.width)),
      height: Math.max(MIN_HEIGHT, finiteOr(geo.height, DEFAULT_GEOMETRY.height)),
    },
    open: o.open === true,
  }
}

/** 取最接近的档位（手改出来的 17px 归到 16 或 18，而不是让字号与档位表脱钩） */
export function nearest<T extends number>(steps: readonly T[], value: number): T {
  let best = steps[0]!
  let dist = Math.abs(value - best)
  for (const s of steps) {
    const d = Math.abs(value - s)
    if (d < dist) { best = s; dist = d }
  }
  return best
}

/** 把浮窗夹回视口内：窗口缩小 / 换屏之后旧坐标可能整个跑到屏幕外，
 *  那样用户再也抓不到它。夹取只保证**至少露出一角**可拖。 */
export function clampGeometry(g: Geometry, viewport: { width: number; height: number }): Geometry {
  const width = clamp(g.width, MIN_WIDTH, Math.max(MIN_WIDTH, viewport.width))
  const height = clamp(g.height, MIN_HEIGHT, Math.max(MIN_HEIGHT, viewport.height))
  const x = clamp(g.x, -width + 80, Math.max(0, viewport.width - 80))
  const y = clamp(g.y, 0, Math.max(0, viewport.height - 60))
  return { x, y, width, height }
}

/** 读存储（坏了就当没有——不抛） */
export function loadPersisted(storage: Pick<Storage, 'getItem'> | null): Persisted {
  if (storage === null) return DEFAULT_PERSISTED
  try {
    const text = storage.getItem(STORAGE_KEY)
    if (text === null) return DEFAULT_PERSISTED
    return normalizePersisted(JSON.parse(text))
  } catch {
    return DEFAULT_PERSISTED
  }
}

/** 写存储（满 / 隐私模式禁写都吞掉：偏好存不下不该妨碍读书） */
export function savePersisted(storage: Pick<Storage, 'setItem'> | null, value: Persisted): void {
  if (storage === null) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    /* 存不下就算了 */
  }
}
