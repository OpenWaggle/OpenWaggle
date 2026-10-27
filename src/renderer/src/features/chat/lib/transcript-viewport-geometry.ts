/** The layout the transcript viewport controller reads and writes, so its rules test without a DOM. */
export interface ViewportGeometry {
  getScrollTop(): number
  setScrollTop(value: number): void
  getClientHeight(): number
  /** Scrollable height excluding the reserved end space. */
  getContentHeight(): number
  /** Reserves space after the last row so a sent message can sit near the top. */
  setEndSpace(height: number): void
  /** Top of the row with this key relative to the viewport top, or `null` when not mounted. */
  getRowTop(key: string): number | null
  /** Height of the row with this key, or `null` when not mounted. */
  getRowHeight(key: string): number | null
  /** The first row whose bottom is below the viewport top. */
  getFirstVisibleRow(): { readonly key: string; readonly top: number } | null
}

export const TRANSCRIPT_ROW_KEY_ATTRIBUTE = 'data-transcript-row-key'

export interface TranscriptViewportElements {
  readonly scroller: () => HTMLElement | null
  readonly content: () => HTMLElement | null
  readonly endSpace: () => HTMLElement | null
}

function rowElements(content: HTMLElement | null): ArrayLike<HTMLElement> {
  return content ? content.querySelectorAll<HTMLElement>(`[${TRANSCRIPT_ROW_KEY_ATTRIBUTE}]`) : []
}

/**
 * The index of the first row whose bottom is below `top`, or `rows.length` when none is.
 *
 * Rows are stacked in document order, so their bottoms only grow: a binary search measures about
 * log2(rows) of them. Walking from the first row measured every mounted row on each commit while
 * the reader followed the live end, which was most of the streaming layout work.
 */
export function firstRowIndexBelow(rows: ArrayLike<HTMLElement>, top: number) {
  let low = 0
  let high = rows.length
  while (low < high) {
    const middle = (low + high) >>> 1
    const row = rows[middle]
    if (row && row.getBoundingClientRect().bottom > top) high = middle
    else low = middle + 1
  }
  return low
}

/** Keys of the rows intersecting the band from `top` to `bottom`, in order. */
export function rowKeysWithin(content: HTMLElement | null, top: number, bottom: number) {
  const keys = new Set<string>()
  const rows = rowElements(content)
  for (let index = firstRowIndexBelow(rows, top); index < rows.length; index += 1) {
    const row = rows[index]
    if (!row || row.getBoundingClientRect().top >= bottom) break
    const key = row.getAttribute(TRANSCRIPT_ROW_KEY_ATTRIBUTE)
    if (key) keys.add(key)
  }
  return keys
}

/*
 * The content column is at least as tall as the viewport, so when its rows and end space are
 * shorter, the difference is empty slack below the end space. It is not content: counting it made
 * a held turn look taller than it was, the end space came out short, and the browser clamped the
 * sent message down the screen when the first message of a Session shrank its reply rows.
 */
function minHeightSlack(content: HTMLElement | null, endSpace: HTMLElement | null) {
  if (!content || !endSpace) return 0
  // Both edges in the same frame, so a positioned ancestor between them cannot skew the slack.
  return Math.max(
    0,
    content.getBoundingClientRect().bottom - endSpace.getBoundingClientRect().bottom,
  )
}

function rowElement(content: HTMLElement | null, key: string) {
  return (
    content?.querySelector<HTMLElement>(`[${TRANSCRIPT_ROW_KEY_ATTRIBUTE}="${CSS.escape(key)}"]`) ??
    null
  )
}

/** The browser-backed geometry the viewport controller reads and writes. */
export function createDomViewportGeometry(elements: TranscriptViewportElements): ViewportGeometry {
  function viewportTop() {
    return elements.scroller()?.getBoundingClientRect().top ?? 0
  }

  return {
    getScrollTop: () => elements.scroller()?.scrollTop ?? 0,
    setScrollTop: (value) => {
      const scroller = elements.scroller()
      if (scroller) scroller.scrollTop = value
    },
    getClientHeight: () => elements.scroller()?.clientHeight ?? 0,
    getContentHeight: () => {
      const scroller = elements.scroller()
      if (!scroller) return 0
      const endSpace = elements.endSpace()
      const endSpaceHeight = endSpace?.offsetHeight ?? 0
      return scroller.scrollHeight - endSpaceHeight - minHeightSlack(elements.content(), endSpace)
    },
    setEndSpace: (height) => {
      const endSpace = elements.endSpace()
      if (endSpace) endSpace.style.height = `${String(height)}px`
    },
    getRowTop: (key) => {
      const row = rowElement(elements.content(), key)
      return row ? row.getBoundingClientRect().top - viewportTop() : null
    },
    getRowHeight: (key) =>
      rowElement(elements.content(), key)?.getBoundingClientRect().height ?? null,
    getFirstVisibleRow: () => {
      const top = viewportTop()
      const rows = rowElements(elements.content())
      const row = rows[firstRowIndexBelow(rows, top)]
      const key = row?.getAttribute(TRANSCRIPT_ROW_KEY_ATTRIBUTE)
      return row && key ? { key, top: row.getBoundingClientRect().top - top } : null
    },
  }
}
