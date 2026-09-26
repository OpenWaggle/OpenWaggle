import type { ViewportGeometry } from './transcript-viewport-controller'

export const TRANSCRIPT_ROW_KEY_ATTRIBUTE = 'data-transcript-row-key'

export interface TranscriptViewportElements {
  readonly scroller: () => HTMLElement | null
  readonly content: () => HTMLElement | null
  readonly endSpace: () => HTMLElement | null
}

function rowElements(content: HTMLElement | null) {
  return content ? content.querySelectorAll<HTMLElement>(`[${TRANSCRIPT_ROW_KEY_ATTRIBUTE}]`) : []
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
      return scroller.scrollHeight - (elements.endSpace()?.offsetHeight ?? 0)
    },
    setEndSpace: (height) => {
      const endSpace = elements.endSpace()
      if (endSpace) endSpace.style.height = `${String(height)}px`
    },
    getRowTop: (key) => {
      const content = elements.content()
      const row = content?.querySelector<HTMLElement>(
        `[${TRANSCRIPT_ROW_KEY_ATTRIBUTE}="${CSS.escape(key)}"]`,
      )
      return row ? row.getBoundingClientRect().top - viewportTop() : null
    },
    getFirstVisibleRow: () => {
      const top = viewportTop()
      for (const row of rowElements(elements.content())) {
        const rect = row.getBoundingClientRect()
        const key = row.getAttribute(TRANSCRIPT_ROW_KEY_ATTRIBUTE)
        if (key && rect.bottom > top) return { key, top: rect.top - top }
      }
      return null
    },
  }
}
