import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { createDomViewportGeometry, firstRowIndexBelow } from '../transcript-viewport-geometry'

/** A viewport-relative box; the unit environment has no DOM. */
function rect(top: number, height: number) {
  return fromPartial<DOMRect>({ top, bottom: top + height, height })
}

function geometry(input: {
  scrollHeight: number
  contentHeight: number
  endSpaceTop: number
  endSpaceHeight: number
}) {
  const scroller = fromPartial<HTMLElement>({ scrollHeight: input.scrollHeight })
  // The content column is scrolled, as in the app: rects are relative to the viewport.
  const scrolled = -120
  const content = fromPartial<HTMLElement>({
    getBoundingClientRect: () => rect(scrolled, input.contentHeight),
  })
  const endSpace = fromPartial<HTMLElement>({
    offsetHeight: input.endSpaceHeight,
    getBoundingClientRect: () => rect(scrolled + input.endSpaceTop, input.endSpaceHeight),
  })
  return createDomViewportGeometry({
    scroller: () => scroller,
    content: () => content,
    endSpace: () => endSpace,
  })
}

describe('createDomViewportGeometry', () => {
  it('measures content as the rows above the end space', () => {
    expect(
      geometry({
        scrollHeight: 900,
        contentHeight: 900,
        endSpaceTop: 600,
        endSpaceHeight: 300,
      }).getContentHeight(),
    ).toBe(600)
  })

  it('does not count the slack of a column held at the viewport height as content', () => {
    // Rows 200px and end space 100px inside a 618px viewport: 318px of empty slack below.
    expect(
      geometry({
        scrollHeight: 618,
        contentHeight: 618,
        endSpaceTop: 200,
        endSpaceHeight: 100,
      }).getContentHeight(),
    ).toBe(200)
  })
})

describe('firstRowIndexBelow', () => {
  function rows(count: number, measured: number[]) {
    return Array.from({ length: count }, (_, index) =>
      fromPartial<HTMLElement>({
        getBoundingClientRect: () => {
          measured.push(index)
          return rect(index * 100, 100)
        },
      }),
    )
  }

  it('finds the first row whose bottom is below the edge with a bounded number of reads', () => {
    const measured: number[] = []
    expect(firstRowIndexBelow(rows(160, measured), 15_050)).toBe(150)
    expect(measured.length).toBeLessThanOrEqual(8)
  })

  it('returns the row count when every row ends above the edge', () => {
    expect(firstRowIndexBelow(rows(3, []), 1_000)).toBe(3)
    expect(firstRowIndexBelow([], 0)).toBe(0)
  })
})
