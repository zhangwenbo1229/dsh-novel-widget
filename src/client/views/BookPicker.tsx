/**
 * 选书面板：书架列表（浮窗里没有书时的第一屏）。
 *
 * 只做「挑一本」，不做搜索/换源/加书——那些归 dsh-novel 面板。这里刻意简单：
 * 挂件存在的理由是「不离开当前界面也能接着读」，不是第二本书城。
 */

import { type ReactNode } from 'react'
import { t } from '../copy.js'
import type { ShelfEntry } from '../wire.js'

export interface BookPickerProps {
  books: ShelfEntry[]
  loading: boolean
  error: string | null
  onPick: (book: ShelfEntry) => void
  onRetry: () => void
  /** 当前在读的书（用来标「继续读」） */
  currentKey: string | null
}

/** 进度行文案：读过显章号，没读过显「未开始」 */
function progressLine(book: ShelfEntry): string {
  if (book.progress.chapterIndex > 0 || book.progress.offsetRatio > 0) {
    return t('pick.progressAt', { n: book.progress.chapterIndex + 1 })
  }
  return t('pick.unread')
}

function Cover({ book }: { book: ShelfEntry }): ReactNode {
  if (book.coverUrl !== undefined && book.coverUrl !== '') {
    return <img className="dnw-book-cover" src={book.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
  }
  // 没有封面：取书名首字当色块（比一个空白框更像一本书）
  return <div className="dnw-book-cover" aria-hidden="true">{book.title.slice(0, 1)}</div>
}

export function BookPicker({ books, loading, error, onPick, onRetry, currentKey }: BookPickerProps): ReactNode {
  if (loading) {
    return <div className="dnw-state">{t('pick.loading')}</div>
  }
  if (error !== null) {
    return (
      <div className="dnw-state">
        <div className="dnw-state-title dnw-state-error">{t('pick.failed')}</div>
        <div className="dnw-state-hint">{error}</div>
        <button type="button" className="dnw-ghost" onClick={onRetry}>{t('read.retry')}</button>
      </div>
    )
  }
  if (books.length === 0) {
    return (
      <div className="dnw-state">
        <div className="dnw-state-title">{t('pick.empty.title')}</div>
        <div className="dnw-state-hint">{t('pick.empty.hint')}</div>
      </div>
    )
  }
  return (
    <div className="dnw-picklist">
      {books.map((b) => {
        const sub = [b.author ?? '', progressLine(b)].filter((s) => s !== '').join(' · ')
        return (
          <button key={b.bookKey} type="button" className="dnw-book" onClick={() => onPick(b)}>
            <Cover book={b} />
            <span className="dnw-book-meta">
              <span className="dnw-book-title">
                {b.title}
                {b.bookKey === currentKey && <span className="dnw-title-sub">· {t('pick.continue')}</span>}
              </span>
              <span className="dnw-book-sub">
                {sub}
                {b.sourceName === null && ` · ${t('pick.noLocation')}`}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
