/**
 * 气泡入口的鲸鱼字形（单点，与 icon.svg 同形）。
 *
 * 造型用**基本几何**拼出来：大圆鲸身 + 右下角一枚墨色圆挖出腹部留白 +
 * 右上小扇形尾鳍 + 一颗眼。参考图的辨识度就来自这四件事，不靠细节。
 *
 * 几何拼装的两个好处：任意缩放不失真；不会像手描路径那样溢出 viewBox 被裁掉
 * （v2 的尾鳍就被裁成了一根尖刺）。
 *
 * 深色圆底也画进来：参考图成立的前提是「白图案压深底」，
 * 气泡本身是浅色，只画白鲸会看不见。
 */
export const WHALE_GLYPH_VIEWBOX = '0 0 32 32'

/** 圆底 */
export const WHALE_DISC = { cx: 16, cy: 16, r: 15 }
/** 鲸身（大圆，画面主体） */
export const WHALE_BODY = { cx: 14.2, cy: 16.6, r: 11.4 }
/** 尾鳍扇形 */
export const WHALE_TAIL_PATH =
  'M22.6 10.1c1.2-2.1 3.1-3.6 5.2-4.2.5-.2.9.4.6.8-1.4 2-3.1 3.6-5 4.9z'
/** 尾柄 */
export const WHALE_STALK_PATH = 'M21.2 12.2l4.4-2.1.7 2.4-4 2.3z'
/** 腹部留白（墨色圆，压在左下角） */
export const WHALE_BELLY = { cx: 5.6, cy: 24.4, r: 6.2 }
/** 眼睛 */
export const WHALE_EYE = { cx: 21.6, cy: 13.6, r: 1.2 }
