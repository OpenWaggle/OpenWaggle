import { describe, expect, it } from 'vitest'
import {
  NEW_TURN_TOP_OFFSET_PX,
  TranscriptViewportController,
  type ViewportGeometry,
} from '../transcript-viewport-controller'

/** A column of rows with known heights, standing in for browser layout. */
function fakeViewport(rows: Array<[string, number]>, clientHeight = 500) {
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

const rows = (count: number, height = 100, prefix = 'row') =>
  Array.from({ length: count }, (_, index): [string, number] => [
    `${prefix}-${String(index)}`,
    height,
  ])

describe('TranscriptViewportController', () => {
  it('follows the live end as content grows', () => {
    const viewport = fakeViewport(rows(10))
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.applyLayout()
    expect(viewport.scrollTop).toBe(500)

    viewport.setRows([...rows(10), ['row-10', 300]])
    controller.applyLayout()
    expect(viewport.scrollTop).toBe(800)
  })

  it('keeps following when the viewport shrinks, such as a growing composer', () => {
    const viewport = fakeViewport(rows(10))
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.applyLayout()

    viewport.setClientHeight(344)
    controller.applyLayout()

    expect(viewport.scrollTop).toBe(viewport.maxScrollTop())
  })

  it('holds the reading position when earlier rows are inserted above it', () => {
    const viewport = fakeViewport(rows(10))
    const controller = new TranscriptViewportController(viewport.geometry)
    viewport.userScrollTo(0)
    controller.handleScroll()
    const before = viewport.rowTop('row-0')

    viewport.setRows([...rows(40, 100, 'older'), ...rows(10)])
    controller.applyLayout()

    // Load earlier used to leave scrollTop unchanged and move the reader's row 16,129px down.
    expect(viewport.rowTop('row-0')).toBe(before)
    expect(viewport.scrollTop).toBe(4000)
  })

  it('holds the reading position when a turn above folds away', () => {
    const viewport = fakeViewport([['u1', 100], ['work', 1000], ['a1', 100], ...rows(10)])
    const controller = new TranscriptViewportController(viewport.geometry)
    viewport.userScrollTo(1500)
    controller.handleScroll()
    const before = viewport.rowTop('row-3')

    viewport.setRows([['u1', 100], ['fold', 40], ['a1', 100], ...rows(10)])
    controller.applyLayout()

    expect(viewport.rowTop('row-3')).toBe(before)
  })

  it('rejoins the live end when the reader scrolls back near the bottom', () => {
    const viewport = fakeViewport(rows(10))
    const controller = new TranscriptViewportController(viewport.geometry)
    viewport.userScrollTo(100)
    controller.handleScroll()
    expect(controller.isFollowing).toBe(false)

    viewport.userScrollTo(480)
    controller.handleScroll()
    expect(controller.isFollowing).toBe(true)
  })

  it('does not pull a reader back to the end when they nudge upward near the bottom', () => {
    const viewport = fakeViewport(rows(10))
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.applyLayout()
    viewport.userScrollTo(470)
    controller.handleScroll()

    viewport.setRows([...rows(10), ['row-10', 300]])
    controller.applyLayout()
    expect(controller.isFollowing).toBe(false)
    expect(viewport.scrollTop).toBe(470)
  })

  it('keeps following when shrinking content makes the browser clamp the scroll position', () => {
    const viewport = fakeViewport(rows(10))
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.applyLayout()

    // A status row disappears: the browser clamps scrollTop down and fires a scroll event.
    viewport.setRows(rows(9))
    controller.handleScroll()
    viewport.setRows([...rows(9), ['row-9', 400]])
    controller.applyLayout()

    // Found in Electron QA: the clamp read as an upward scroll and the view stopped following.
    expect(controller.isFollowing).toBe(true)
    expect(viewport.scrollTop).toBe(viewport.maxScrollTop())
  })

  it('ignores the echo of its own scroll writes', () => {
    const viewport = fakeViewport(rows(10))
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.applyLayout()
    controller.handleScroll()
    expect(controller.isFollowing).toBe(true)
  })

  it('leaves the live end at once on upward intent', () => {
    const viewport = fakeViewport(rows(10))
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.applyLayout()
    controller.leaveLiveEnd()
    viewport.setRows([...rows(10), ['row-10', 300]])
    controller.applyLayout()
    expect(viewport.scrollTop).toBe(500)
  })

  it('keeps a toggled disclosure under the pointer instead of chasing the end', () => {
    const viewport = fakeViewport(rows(10))
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.applyLayout()
    const foldTop = viewport.rowTop('row-8')

    controller.hold('row-8')
    viewport.setRows([...rows(9), ['row-9', 900]])
    controller.applyLayout()

    expect(viewport.rowTop('row-8')).toBe(foldTop)
    controller.releaseHold()
    expect(controller.isFollowing).toBe(false)
  })

  it('resumes following after a hold that ends at the live end', () => {
    const viewport = fakeViewport(rows(10))
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.applyLayout()
    controller.hold('row-9')
    controller.releaseHold()
    expect(controller.isFollowing).toBe(true)
  })

  it('pins a sent message near the top and reserves space for the reply', () => {
    const viewport = fakeViewport([...rows(10), ['sent', 60]])
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.anchorNewTurn('sent')

    expect(viewport.rowTop('sent')).toBe(NEW_TURN_TOP_OFFSET_PX)
    expect(viewport.endSpace).toBe(500 - NEW_TURN_TOP_OFFSET_PX - 60)

    viewport.setRows([...rows(10), ['sent', 60], ['reply', 200]])
    controller.applyLayout()
    expect(viewport.rowTop('sent')).toBe(NEW_TURN_TOP_OFFSET_PX)
    expect(viewport.endSpace).toBe(500 - NEW_TURN_TOP_OFFSET_PX - 260)
  })

  it('hands a sent turn over to live following once it outgrows the viewport', () => {
    const viewport = fakeViewport([...rows(10), ['sent', 60]])
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.anchorNewTurn('sent')

    viewport.setRows([...rows(10), ['sent', 60], ['reply', 900]])
    controller.applyLayout()

    expect(controller.isFollowing).toBe(true)
    expect(viewport.endSpace).toBe(0)
    expect(viewport.scrollTop).toBe(viewport.maxScrollTop())
  })

  it('restores a saved reading position by row, not by pixel offset', () => {
    const viewport = fakeViewport([...rows(40, 100, 'older'), ...rows(10)])
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.restore({ key: 'row-2', top: 30 })

    expect(viewport.rowTop('row-2')).toBe(30)
    expect(controller.readingPosition()).toEqual({ key: 'row-2', top: 30 })
  })

  it('treats a reading position at the very end as following, when saving and restoring', () => {
    const viewport = fakeViewport(rows(10))
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.restore({ key: 'row-8', top: 18 })

    // Found in Electron QA: restored anchored at the end, a growing composer then hid 156px.
    expect(controller.isFollowing).toBe(true)
    expect(controller.readingPosition()).toBeNull()
  })

  it('keeps the newest content in view when an anchored reader rests exactly at the end', () => {
    const viewport = fakeViewport(rows(10))
    const controller = new TranscriptViewportController(viewport.geometry)
    // An anchor that lands at the end without a restore, as a lost anchor re-captured there does.
    controller.applyLayout()
    controller.hold('row-9')
    controller.releaseHold()
    viewport.setClientHeight(344)
    controller.applyLayout()

    expect(viewport.scrollTop).toBe(viewport.maxScrollTop())
  })

  it('does not treat the bottom of a window with newer unmounted rows as the live end', () => {
    const viewport = fakeViewport(rows(10))
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.setWindowHasLater(true)
    viewport.userScrollTo(100)
    controller.handleScroll()

    // Review finding: reaching the bottom of a capped slice marked the reader following, and the
    // window jumped to the newest rows past all the history in between.
    viewport.userScrollTo(500)
    controller.handleScroll()
    controller.applyLayout()
    expect(controller.isFollowing).toBe(false)
    // Saved as a reading position, not "following": reopening must not skip the history between.
    expect(controller.readingPosition()).not.toBeNull()
    controller.restore({ key: 'row-8', top: 18 })
    expect(controller.isFollowing).toBe(false)
  })

  it('keeps the anchor when the final page of newer rows mounts at the window bottom', () => {
    const viewport = fakeViewport(rows(10))
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.setWindowHasLater(true)
    viewport.userScrollTo(100)
    controller.handleScroll()
    viewport.userScrollTo(500)
    controller.handleScroll()
    const anchored = controller.readingPosition()

    viewport.setRows([...rows(10), ...rows(5, 100, 'later')])
    controller.setWindowHasLater(false)
    controller.applyLayout()

    // Review finding: a stale "resting at the end" turned this into following, skipping the page.
    expect(controller.isFollowing).toBe(false)
    expect(controller.readingPosition()).toEqual(anchored)
  })

  it('moves the anchor to the next visible row when its row leaves the DOM', () => {
    const viewport = fakeViewport(rows(10))
    const controller = new TranscriptViewportController(viewport.geometry)
    viewport.userScrollTo(250)
    controller.handleScroll()
    expect(controller.readingPosition()?.key).toBe('row-2')

    viewport.setRows(rows(10).filter(([key]) => key !== 'row-2'))
    controller.applyLayout()
    expect(controller.readingPosition()?.key).not.toBe('row-2')
  })
})
