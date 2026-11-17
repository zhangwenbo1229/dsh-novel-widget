/**
 * 样式层：**只吃宿主主题 token**（`--dsw-alias-*`），不自己判深浅色。
 *
 * 宿主 `Theme.listTokens` 给出的每个 token 都要求明暗两套，意味着只要用它们，
 * 挂件就自动跟着宿主主题走——包括用户在设置里切换主题的那一刻。自己写死颜色
 * 会出现「宿主是深色、挂件是白底」这种一眼假的接缝。
 *
 * 样式用 <style> 标签注入而不是内联：本挂件要写 :hover / ::-webkit-scrollbar 这类
 * 内联表达不了的东西。
 */

import type { ReactNode } from 'react'

const CSS = `
.dnw-root, .dnw-root * { box-sizing: border-box; }

.dnw-root {
  --dnw-fg: var(--dsw-alias-label-primary, #1f2328);
  --dnw-fg-dim: var(--dsw-alias-label-secondary, #6b7280);
  --dnw-bg: var(--dsw-alias-bg-overlay, #ffffff);
  --dnw-bg-2: var(--dsw-alias-bg-layer-2, #f3f4f6);
  --dnw-border: var(--dsw-alias-border-l1, #e5e7eb);
  --dnw-border-2: var(--dsw-alias-border-l2, #d1d5db);
  --dnw-accent: var(--dsw-alias-brand-primary, #2563eb);
  --dnw-danger: var(--dsw-alias-state-error-primary, #dc2626);
  /* 气泡是「一张白纸」：不跟宿主表面色走，深色主题下也读白底黑字。
     阅读这件事的对比度由纸决定，不由界面主题决定——主面板阅读区同理。 */
  --dnw-paper: #ffffff;
  --dnw-paper-ink: #1a1a1a;
  --dnw-paper-dim: #6b7280;
  --dnw-paper-line: #ededed;
  color: var(--dnw-fg);
  font-family: inherit;
}

.dnw-bubble {
  position: fixed;
  z-index: 2147482000;
  width: 44px; height: 44px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--dnw-bg);
  border: 1px solid var(--dnw-border-2);
  box-shadow: 0 4px 16px rgba(0,0,0,.18);
  cursor: pointer;
  pointer-events: auto;
  user-select: none;
  color: var(--dnw-accent);
  transition: transform .12s ease, box-shadow .12s ease;
  padding: 0;
}
.dnw-bubble:hover { transform: scale(1.06); box-shadow: 0 6px 22px rgba(0,0,0,.24); }
.dnw-bubble:focus-visible { outline: 2px solid var(--dnw-accent); outline-offset: 2px; }
.dnw-bubble[data-dragging="true"] { cursor: grabbing; transition: none; }
/* 吸附态：透明度由 JS 给（悬停/聚焦回升到 1），这里只管过渡与形状 */
.dnw-bubble { transition: transform .12s ease, box-shadow .12s ease, opacity .18s ease; }
/* 贴住的那一侧裁成直角，看起来才像「贴在边上」而不是浮在边上 */
.dnw-bubble[data-side="left"] { border-top-left-radius: 4px; border-bottom-left-radius: 4px; }
.dnw-bubble[data-side="right"] { border-top-right-radius: 4px; border-bottom-right-radius: 4px; }
.dnw-bubble[data-side="top"] { border-top-left-radius: 4px; border-top-right-radius: 4px; }
.dnw-bubble[data-side="bottom"] { border-bottom-left-radius: 4px; border-bottom-right-radius: 4px; }
.dnw-bubble[data-snapped="true"]:not(:hover):not(:focus-visible) { box-shadow: 0 2px 8px rgba(0,0,0,.14); }
/* 气泡里的鲸鱼字形（SVG）：尺寸固定、居中，颜色随气泡前景色（currentColor）。
   原来这里是一个「读」字，靠 font-size 定大小；换成矢量之后由 width/height 定，
   字号类规则留着只会误导。 */
.dnw-bubble-glyph { display: block; pointer-events: none; }
.dnw-bubble { padding: 6px; }
.dnw-bubble-dot {
  position: absolute; top: 2px; right: 2px;
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--dsw-alias-state-success-primary, #16a34a);
  border: 1.5px solid var(--dnw-bg);
}

.dnw-window {
  position: fixed;
  z-index: 2147482001;
  display: flex; flex-direction: column;
  background: var(--dnw-paper);
  color: var(--dnw-paper-ink);
  /* 参考图那种「消息气泡」：四周统一圆角，尖角由 .dnw-arrow 单独长出 */
  border-radius: 20px;
  border: none;                       /* 描边交给尖角与投影，否则圆角处会叠出双线 */
  box-shadow: 0 2px 0 -1px var(--dnw-border-2), 0 14px 44px rgba(0,0,0,.20),
              inset 0 0 0 1px var(--dnw-border-2);
  pointer-events: auto;
  min-width: 240px; min-height: 120px;
  overflow: visible;   /* 尖角要能露出窗口边框之外 */

  /*
   * 弹出 / 缩回：**只动透明度，不动 transform**。
   *
   * 这不是审美取舍：命中判定要量窗口的真实矩形，而 transform（scale / translate）会让
   * 浏览器在动画期间返回**变形后**的框——早先那次「鼠标还在窗口里就缩回」的根因之一，
   * 就是在缩放动画进行中量到了那个小一圈的框。不引入 transform，量到的框从头到尾都准，
   * 不必再靠 animationend 事后补量。
   */
  animation: dnw-pop 150ms ease-out both;
}
.dnw-window.is-leaving { animation: dnw-unpop 130ms ease-in both; pointer-events: none; }

@keyframes dnw-pop {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes dnw-unpop {
  from { opacity: 1; }
  to   { opacity: 0; }
}

/* 基础按钮：清掉浏览器原生外观。宿主样式能兜住，但挂件脱离宿主（预览 / 宿主改版）
   就会露出原生灰框——按钮的底子必须自己交代清楚。 */
.dnw-btn {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dnw-paper-dim);
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  line-height: 1;
  padding: 5px 7px;
  flex: 0 0 auto;
}
.dnw-window > .dnw-btn {
  appearance: none; border: 1px solid transparent;
  background: transparent; color: var(--dnw-paper-dim);
  border-radius: 6px; cursor: pointer;
  font-size: 12px; line-height: 1;
  padding: 5px 7px;
  flex: 0 0 auto;
}
.dnw-btn:hover { background: #f2f2f2; color: var(--dnw-paper-ink); }
.dnw-btn:focus-visible { outline: 2px solid var(--dnw-accent); outline-offset: 1px; }
.dnw-btn[aria-pressed="true"] { background: #eef0f3; color: var(--dnw-paper-ink); }
/* 「换一本」这类次要动作：更淡、更小，不跟翻页键抢注意力 */
.dnw-btn-quiet { opacity: .62; font-size: 11px; padding: 5px 5px; }
.dnw-btn-quiet:hover { opacity: 1; }

.dnw-body { flex: 1 1 auto; overflow: hidden; display: flex; flex-direction: column; min-height: 0; position: relative; }

/* ── 正文内联提示（加载中 / 失败 / 图文不支持）─────────── */
.dnw-hint {
  font-size: calc(var(--dnw-font) * .88);
  color: var(--dnw-paper-dim);
  line-height: 1.6;
}
.dnw-link {
  appearance: none; border: none; background: none;
  color: var(--dnw-accent);
  font-size: calc(var(--dnw-font) * .85);
  cursor: pointer; padding: 4px 0 0;
  font-family: inherit;
}
.dnw-link:hover { text-decoration: underline; }
.dnw-link:focus-visible { outline: 2px solid var(--dnw-accent); outline-offset: 2px; border-radius: 4px; }

.dnw-scroll {
  background: var(--dnw-paper);
  flex: 1 1 auto;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 16px 16px 10px;
  /* 滚动条整体隐藏（用户要求）：气泡是个小窗，右侧挂一条灰杠既占宽又扎眼。
     滚动能力不变——滚轮、触控板、键盘、拖选都照旧，只是不画那根杠。 */
  scrollbar-width: none;      /* Firefox */
  -ms-overflow-style: none;   /* 旧 Edge/IE */
  overscroll-behavior: contain;
}
.dnw-scroll::-webkit-scrollbar { width: 0; height: 0; display: none; }
/* 目录抽屉同理：那里也是长列表，露一条杠会更显乱 */
.dnw-toc { scrollbar-width: none; -ms-overflow-style: none; }
.dnw-toc::-webkit-scrollbar { width: 0; height: 0; display: none; }

/* 章节块。**刻意不用 content-visibility: auto**：它会让屏幕外的章报出接近 0 的高度，
 *  而落位与进度都靠实测高度算——量到 0 就等于算错（真机上表现为「跳转落在窗口第一张」
 *  与「点第 21 章看到第 19 章」）。窗口本身只保留 6 章，省这一点的收益远小于代价。 */
.dnw-chapter { }
.dnw-chapter + .dnw-chapter { border-top: 1px dashed var(--dnw-paper-line); margin-top: 20px; padding-top: 16px; }
.dnw-chapter-title {
  font-size: calc(var(--dnw-font) * 1.1);
  font-weight: 600;
  margin: 0 0 10px;
  color: var(--dnw-paper-ink);
  line-height: 1.4;
}
.dnw-prose {
  margin: 0 auto;
  background: transparent;
  max-width: calc(var(--dnw-measure) * 1em);
  font-size: var(--dnw-font);
  line-height: var(--dnw-line);
  color: var(--dnw-paper-ink);
  word-break: break-word;
}
.dnw-prose p { margin: 0 0 .7em; text-indent: 2em; }
.dnw-prose p.dnw-blank { margin: 0; text-indent: 0; height: .6em; }

.dnw-chapter-end {
  display: flex; gap: 8px; justify-content: center;
  padding: 18px 0 4px;
}
.dnw-chapter-end button { min-width: 88px; }

.dnw-state {
  flex: 1 1 auto; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 10px; padding: 24px; text-align: center;
  color: var(--dnw-paper-dim); font-size: 13px; line-height: 1.6;
}
.dnw-state-title { color: var(--dnw-paper-ink); font-weight: 600; font-size: 14px; }
.dnw-state-hint { max-width: 28em; }
.dnw-state-error { color: var(--dnw-danger); }

.dnw-primary {
  appearance: none; border: 1px solid var(--dnw-accent);
  background: var(--dnw-accent); color: #fff;
  border-radius: 7px; cursor: pointer;
  font-size: 13px; padding: 7px 14px;
  font-family: inherit;
}
.dnw-primary:hover { filter: brightness(1.06); }
.dnw-primary:focus-visible { outline: 2px solid var(--dnw-accent); outline-offset: 2px; }
.dnw-ghost {
  appearance: none; border: 1px solid var(--dnw-paper-line);
  background: transparent; color: var(--dnw-paper-ink);
  border-radius: 7px; cursor: pointer;
  font-size: 13px; padding: 7px 14px;
  font-family: inherit;
}
.dnw-ghost:hover { background: #f6f6f6; }
.dnw-ghost:focus-visible { outline: 2px solid var(--dnw-accent); outline-offset: 2px; }
.dnw-ghost:disabled { opacity: .45; cursor: default; }
.dnw-ghost:disabled:hover { background: transparent; }

.dnw-picklist { flex: 1 1 auto; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.dnw-book {
  display: flex; gap: 10px; align-items: center;
  padding: 8px; border-radius: 8px; cursor: pointer;
  border: 1px solid transparent; text-align: left;
  background: transparent; color: inherit; width: 100%;
  font: inherit;
}
.dnw-book:hover { background: #f6f6f6; border-color: var(--dnw-paper-line); }
.dnw-book:focus-visible { outline: 2px solid var(--dnw-accent); outline-offset: 1px; }
.dnw-book-cover {
  width: 38px; height: 52px; border-radius: 4px; flex: 0 0 auto;
  background: #f2f2f2; object-fit: cover;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; color: var(--dnw-paper-dim); overflow: hidden;
  border: 1px solid var(--dnw-paper-line);
}
.dnw-book-meta { min-width: 0; flex: 1 1 auto; }
.dnw-book-title { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dnw-book-sub { font-size: 11px; color: var(--dnw-paper-dim); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.dnw-drawer {
  position: absolute; inset: 0; z-index: 5;
  background: var(--dnw-paper);
  display: flex; flex-direction: column;
}
.dnw-drawer-head {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-bottom: 1px solid var(--dnw-border);
  background: var(--dnw-paper); flex: 0 0 auto;
}
.dnw-drawer-title { flex: 1 1 auto; font-size: 13px; font-weight: 600; }
.dnw-drawer-count { font-size: 11px; color: var(--dnw-paper-dim); white-space: nowrap; }
/* 顺序开关：右上角那颗，选中态（倒序）用主色标示，一眼看出「现在不是缺省顺序」 */
.dnw-toc-order { font-size: 11px; padding: 4px 8px; color: var(--dnw-paper-dim); }
.dnw-toc-order[aria-pressed="true"] {
  color: var(--dnw-accent);
  background: #f0f5ff;
  font-weight: 600;
}
/* 刷新按钮：与顺序开关同排，但它是「动作」不是「状态」，所以常态就用主色可辨 */
.dnw-toc-refresh { font-size: 11px; padding: 4px 8px; color: var(--dnw-accent); }
.dnw-toc-refresh:disabled { color: var(--dnw-paper-dim); cursor: default; }
/* 刷新结果回执：贴在头部下面一条，几秒后自己消失 */
.dnw-drawer-note {
  padding: 6px 12px;
  font-size: 11px;
  color: var(--dnw-paper-dim);
  background: #fafafa;
  border-bottom: 1px solid var(--dnw-paper-line);
  flex: 0 0 auto;
}
.dnw-toc { flex: 1 1 auto; overflow-y: auto; padding: 6px; }
.dnw-toc-item {
  display: block; width: 100%; text-align: left;
  padding: 6px 8px; border-radius: 6px; cursor: pointer;
  font-size: 12.5px; line-height: 1.5;
  background: transparent; border: none; color: var(--dnw-paper-ink);
  font-family: inherit;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dnw-toc-item:hover { background: #f4f4f4; }
.dnw-toc-item:focus-visible { outline: 2px solid var(--dnw-accent); outline-offset: -2px; }
.dnw-toc-item[data-current="true"] { color: var(--dnw-accent); font-weight: 600; background: #f0f5ff; }
.dnw-toc-spacer { position: relative; }

.dnw-prefs {
  border-top: 1px solid var(--dnw-border);
  background: #fafafa;
  padding: 8px 10px; display: flex; flex-direction: column; gap: 6px;
  flex: 0 0 auto;
}
.dnw-pref-row { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--dnw-paper-dim); }
.dnw-pref-label { flex: 0 0 32px; }
.dnw-pref-value { flex: 0 0 44px; text-align: right; font-variant-numeric: tabular-nums; }
.dnw-pref-row input[type="range"] { flex: 1 1 auto; accent-color: var(--dnw-accent); }

.dnw-footer {
  display: flex; align-items: center; gap: 4px;
  padding: 6px 8px 8px; border-top: 1px solid var(--dnw-border);
  background: var(--dnw-paper); flex: 0 0 auto;
  font-size: 11px; color: var(--dnw-paper-dim);
}
.dnw-footer-spacer { flex: 1 1 auto; text-align: center; font-variant-numeric: tabular-nums; }

.dnw-resize {
  position: absolute; right: 0; bottom: 0;
  width: 16px; height: 16px; cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, var(--dnw-border-2) 50%, var(--dnw-border-2) 65%, transparent 65%);
  border-bottom-right-radius: 12px;
}

.dnw-sr {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
/* ── 右键换书菜单 ─────────────────────────────────────────── */
.dnw-menu {
  position: fixed;
  z-index: 2147482002;
  min-width: 180px; max-width: 280px;
  display: flex; flex-direction: column;
  background: var(--dnw-paper);
  color: var(--dnw-paper-ink);
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0,0,0,.20), inset 0 0 0 1px var(--dnw-paper-line);
  overflow: hidden;
  pointer-events: auto;
  animation: dnw-menu-in 120ms cubic-bezier(.2,.9,.3,1.1) both;
}
@keyframes dnw-menu-in {
  from { opacity: 0; transform: scale(.96); }
  to   { opacity: 1; transform: scale(1); }
}
.dnw-menu-title {
  padding: 8px 12px 6px;
  font-size: 11px;
  color: var(--dnw-paper-dim);
  border-bottom: 1px solid var(--dnw-paper-line);
  user-select: none;
}
.dnw-menu-list { overflow-y: auto; padding: 4px; }
.dnw-menu-item {
  display: flex; align-items: center; gap: 6px;
  width: 100%; padding: 7px 8px;
  border: none; border-radius: 7px;
  background: transparent; color: inherit;
  font: inherit; font-size: 12.5px;
  text-align: left; cursor: pointer;
}
.dnw-menu-item:hover { background: #f2f2f2; }
.dnw-menu-item:focus-visible { outline: 2px solid var(--dnw-accent); outline-offset: -2px; }
.dnw-menu-item[aria-checked="true"] { color: var(--dnw-accent); font-weight: 600; }
.dnw-menu-check { flex: 0 0 12px; font-size: 11px; text-align: center; }
.dnw-menu-label { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dnw-menu-sub { flex: 0 0 auto; font-size: 11px; color: var(--dnw-paper-dim); font-weight: 400; }
.dnw-menu-empty { padding: 12px; font-size: 12px; color: var(--dnw-paper-dim); text-align: center; }`

/** 样式层（一个 <style> 元素；多棵子树各挂一份也只多一份文本，规则相同） */
export function WidgetStyles(): ReactNode {
  return <style data-dnw-style="">{CSS}</style>
}


