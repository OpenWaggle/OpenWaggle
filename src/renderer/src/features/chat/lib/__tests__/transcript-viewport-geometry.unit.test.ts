import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
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

describe('createDomViewportGeometry row lookup', () => {
  function row(key: string, top: number) {
    const state = { connected: true }
    const element = fromPartial<HTMLElement>({
      get isConnected() {
        return state.connected
      },
      getAttribute: () => key,
      getBoundingClientRect: () => rect(top, 50),
    })
    return { element, unmount: () => (state.connected = false) }
  }

  it('finds a row once while it stays mounted, and again once it is replaced', () => {
    vi.stubGlobal('CSS', { escape: (value: string) => value })
    const first = row('message:a', 100)
    const querySelector = vi.fn(() => first.element)
    const content = fromPartial<HTMLElement>({
      querySelector,
      contains: (node: HTMLElement) => node.isConnected,
    })
    const scroller = fromPartial<HTMLElement>({ getBoundingClientRect: () => rect(0, 500) })
    const geometry = createDomViewportGeometry({
      scroller: () => scroller,
      content: () => content,
      endSpace: () => null,
    })

    expect(geometry.getRowTop('message:a')).toBe(100)
    expect(geometry.getRowHeight('message:a')).toBe(50)
    expect(geometry.getRowTop('message:a')).toBe(100)
    expect(querySelector).toHaveBeenCalledTimes(1)

    first.unmount()
    const replacement = row('message:a', 160)
    querySelector.mockReturnValue(replacement.element)
    expect(geometry.getRowTop('message:a')).toBe(160)
    expect(querySelector).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })

  it('tells whether a row is mounted without measuring it', () => {
    vi.stubGlobal('CSS', { escape: (value: string) => value })
    const mounted = row('message:a', 100)
    const measure = vi.fn(() => rect(100, 50))
    const element = fromPartial<HTMLElement>({ ...mounted.element, getBoundingClientRect: measure })
    const content = fromPartial<HTMLElement>({
      querySelector: (selector: string) => (selector.includes('message:a') ? element : null),
      contains: () => true,
    })
    const geometry = createDomViewportGeometry({
      scroller: () => fromPartial<HTMLElement>({ getBoundingClientRect: () => rect(0, 500) }),
      content: () => content,
      endSpace: () => null,
    })

    expect(geometry.hasRow('message:a')).toBe(true)
    expect(geometry.hasRow('message:b')).toBe(false)
    expect(measure).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
