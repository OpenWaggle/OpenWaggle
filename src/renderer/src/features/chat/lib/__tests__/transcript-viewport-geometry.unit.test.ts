import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { createDomViewportGeometry } from '../transcript-viewport-geometry'

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
