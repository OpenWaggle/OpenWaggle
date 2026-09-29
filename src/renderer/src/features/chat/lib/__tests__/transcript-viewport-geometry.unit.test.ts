import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { createDomViewportGeometry } from '../transcript-viewport-geometry'

function geometry(input: {
  scrollHeight: number
  contentHeight: number
  endSpaceTop: number
  endSpaceHeight: number
}) {
  const scroller = fromPartial<HTMLElement>({ scrollHeight: input.scrollHeight })
  const content = fromPartial<HTMLElement>({ offsetTop: 0, offsetHeight: input.contentHeight })
  const endSpace = fromPartial<HTMLElement>({
    offsetTop: input.endSpaceTop,
    offsetHeight: input.endSpaceHeight,
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
