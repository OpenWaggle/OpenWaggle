import type { TranscriptRowIndex } from '../transcript-sent-turn'
import type { ViewportGeometry } from '../transcript-viewport-geometry'

/** A column of rows with known heights, standing in for browser layout. */
export function fakeViewport(rows: Array<[string, number]>, clientHeight = 500) {
  let list = rows
  let scrollTop = 0
  let endSpace = 0
  let height = clientHeight
  const contentHeight = () => list.reduce((sum, [, rowHeight]) => sum + rowHeight, 0)
  const offsetOf = (key: string) => {
    let offset = 0
    for (const [rowKey, rowHeight] of list) {
      if (rowKey === key) return offset
      offset += rowHeight
    }
    return null
  }
  const clamp = (value: number) =>
    Math.min(Math.max(0, value), Math.max(0, contentHeight() + endSpace - height))
  const geometry: ViewportGeometry = {
    getScrollTop: () => scrollTop,
    setScrollTop: (value) => {
      scrollTop = clamp(value)
    },
    getClientHeight: () => height,
    getContentHeight: contentHeight,
    setEndSpace: (value) => {
      endSpace = value
      scrollTop = clamp(scrollTop)
    },
    getRowTop: (key) => {
      const offset = offsetOf(key)
      return offset === null ? null : offset - scrollTop
    },
    getRowHeight: (key) => list.find(([rowKey]) => rowKey === key)?.[1] ?? null,
    getFirstVisibleRow: () => {
      let offset = 0
      for (const [key, rowHeight] of list) {
        if (offset + rowHeight > scrollTop) return { key, top: offset - scrollTop }
        offset += rowHeight
      }
      return null
    },
  }
  return {
    geometry,
    setRows: (next: Array<[string, number]>) => {
      list = next
      scrollTop = clamp(scrollTop)
    },
    setClientHeight: (value: number) => {
      height = value
      scrollTop = clamp(scrollTop)
    },
    /** A reader scrolling, which the controller did not cause. */
    userScrollTo: (value: number) => {
      scrollTop = clamp(value)
    },
    rowTop: (key: string) => geometry.getRowTop(key),
    get scrollTop() {
      return scrollTop
    },
    get endSpace() {
      return endSpace
    },
    maxScrollTop: () => Math.max(0, contentHeight() + endSpace - height),
  }
}

export const rows = (count: number, height = 100, prefix = 'row') =>
  Array.from({ length: count }, (_, index): [string, number] => [
    `${prefix}-${String(index)}`,
    height,
  ])

/** Rows as the controller reads them: which keys are user messages, and which turns do work. */
export function rowIndex(
  keys: readonly string[],
  options: { readonly users?: readonly string[]; readonly workAfter?: readonly string[] } = {},
): TranscriptRowIndex {
  const users = new Set(options.users ?? [])
  const workAfter = new Set(options.workAfter ?? [])
  return { keys, isUserRow: (key) => users.has(key), hasWorkAfter: (key) => workAfter.has(key) }
}

/** The keys of a row list, in order. */
export const keysOf = (list: ReadonlyArray<readonly [string, number]>) => list.map(([key]) => key)
