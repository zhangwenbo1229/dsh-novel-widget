/**
 * 阅读设置条：字号 / 行距 / 栏宽。
 *
 * 只有三根滑杆，没有「纸色」：挂件浮在宿主界面之上，底色必须跟宿主的 token 走
 * （见 `styles.tsx` 头注），再给一张自定义纸色就会在深色主题下露出一块白纸。
 */

import type { ReactNode } from 'react'
import { t } from '../copy.js'
import { FONT_STEPS, LINE_HEIGHTS, MEASURES, nearest, type Prefs } from '../prefs.js'

export interface PrefsBarProps {
  prefs: Prefs
  onChange: (patch: Partial<Prefs>) => void
  onClose: () => void
}

export function PrefsBar({ prefs, onChange, onClose }: PrefsBarProps): ReactNode {
  const fontIdx = FONT_STEPS.indexOf(nearest(FONT_STEPS, prefs.fontPx))
  const lineIdx = LINE_HEIGHTS.indexOf(nearest(LINE_HEIGHTS, prefs.lineHeight))
  const measureIdx = MEASURES.indexOf(nearest(MEASURES, prefs.measureEm))

  return (
    <div className="dnw-prefs" role="group" aria-label={t('prefs.title')}>
      <div className="dnw-pref-row">
        <span className="dnw-pref-label">{t('prefs.font')}</span>
        <input
          type="range"
          min={0}
          max={FONT_STEPS.length - 1}
          step={1}
          value={fontIdx}
          aria-label={t('prefs.font')}
          onChange={(e) => onChange({ fontPx: FONT_STEPS[Number(e.target.value)]! })}
        />
        <span className="dnw-pref-value">{prefs.fontPx}</span>
      </div>
      <div className="dnw-pref-row">
        <span className="dnw-pref-label">{t('prefs.lineHeight')}</span>
        <input
          type="range"
          min={0}
          max={LINE_HEIGHTS.length - 1}
          step={1}
          value={lineIdx}
          aria-label={t('prefs.lineHeight')}
          onChange={(e) => onChange({ lineHeight: LINE_HEIGHTS[Number(e.target.value)]! })}
        />
        <span className="dnw-pref-value">{prefs.lineHeight.toFixed(1)}</span>
      </div>
      <div className="dnw-pref-row">
        <span className="dnw-pref-label">{t('prefs.measure')}</span>
        <input
          type="range"
          min={0}
          max={MEASURES.length - 1}
          step={1}
          value={measureIdx}
          aria-label={t('prefs.measure')}
          onChange={(e) => onChange({ measureEm: MEASURES[Number(e.target.value)]! })}
        />
        <span className="dnw-pref-value">{prefs.measureEm}em</span>
        <button type="button" className="dnw-btn" onClick={onClose} aria-label={t('prefs.close')}>✕</button>
      </div>
    </div>
  )
}
