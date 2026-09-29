import { describe, expect, it } from 'vitest'
import {
  NEW_TURN_TOP_OFFSET_PX,
  TranscriptViewportController,
} from '../transcript-viewport-controller'
import { fakeViewport, rows } from './transcript-viewport.fixtures'

const TOP = NEW_TURN_TOP_OFFSET_PX

/** A sent turn with a short reply, still reserving space below it. */
function reservedTurn(sentKey = 'sent') {
  const viewport = fakeViewport([...rows(10), [sentKey, 60], ['reply', 100]])
  const controller = new TranscriptViewportController(viewport.geometry)
  controller.anchorNewTurn(sentKey)
  const scrollUp = (delta: number) => {
    viewport.userScrollTo(viewport.scrollTop - delta)
    controller.handleScroll()
    controller.applyLayout()
  }
  return { viewport, controller, scrollUp }
}

describe('TranscriptViewportController reader inside a sent turn', () => {
  it('keeps the reserved space under a reader who scrolls up during the reply', () => {
    const { viewport, controller, scrollUp } = reservedTurn()
    scrollUp(150)
    expect(viewport.rowTop('sent')).toBe(TOP + 150)

    // The reply consumes the reserved space as it grows; the reader's row does not move.
    viewport.setRows([...rows(10), ['sent', 60], ['reply', 200]])
    controller.applyLayout()
    expect(viewport.rowTop('sent')).toBe(TOP + 150)
    expect(viewport.endSpace).toBe(500 - TOP - 260)
  })

  it('keeps a toggled row under the pointer when a disclosure in the turn collapses', () => {
    const { viewport, controller } = reservedTurn()
    controller.hold('reply')
    viewport.setRows([...rows(10), ['sent', 60], ['reply', 300]])
    controller.applyLayout()
    const replyTop = viewport.rowTop('reply')

    controller.hold('reply')
    viewport.setRows([...rows(10), ['sent', 60], ['reply', 100]])
    controller.applyLayout()

    expect(viewport.rowTop('reply')).toBe(replyTop)
    expect(viewport.endSpace).toBe(500 - TOP - 160)
  })

  it('returns to the held sent turn when the reader scrolls back into its reserved space', () => {
    const { viewport, controller, scrollUp } = reservedTurn()
    scrollUp(150)
    viewport.userScrollTo(viewport.maxScrollTop())
    controller.handleScroll()

    expect(controller.isHoldingSentTurn).toBe(true)
    controller.applyLayout()
    expect(viewport.rowTop('sent')).toBe(TOP)
    expect(viewport.endSpace).toBeGreaterThan(0)
  })

  it('does not move a reader who returns to the end after the turn shrank', () => {
    const { viewport, controller, scrollUp } = reservedTurn()
    viewport.setRows([...rows(10), ['sent', 60], ['reply', 300]])
    controller.applyLayout()
    scrollUp(150)
    viewport.setRows([...rows(10), ['sent', 60], ['reply', 100]])
    controller.applyLayout()

    viewport.userScrollTo(viewport.maxScrollTop())
    const readerScrollTop = viewport.scrollTop
    controller.handleScroll()
    controller.applyLayout()

    expect(viewport.scrollTop).toBe(readerScrollTop)
    expect(viewport.rowTop('sent')).toBe(TOP)
  })

  it('moves the held sent turn to the persisted copy of its message', () => {
    const { viewport, controller } = reservedTurn('optimistic')

    viewport.setRows([...rows(10), ['persisted', 60], ['reply', 100]])
    controller.reconcileSentTurn('persisted')
    controller.applyLayout()

    expect(controller.mode).toEqual({ kind: 'new-turn', key: 'persisted', top: TOP })
    expect(viewport.rowTop('persisted')).toBe(TOP)
  })

  it('keeps the reserved space when the message persists under a reader inside the turn', () => {
    const { viewport, controller, scrollUp } = reservedTurn('optimistic')
    scrollUp(150)

    viewport.setRows([...rows(10), ['persisted', 60], ['reply', 100]])
    controller.reconcileSentTurn('persisted')
    controller.applyLayout()

    expect(viewport.rowTop('persisted')).toBe(TOP + 150)
    expect(viewport.endSpace).toBe(500 - TOP - 160)
  })

  it('holds a steer that arrives while the turn is held, like a new send', () => {
    const { viewport, controller } = reservedTurn()

    viewport.setRows([...rows(10), ['sent', 60], ['reply', 100], ['steer', 40]])
    controller.reconcileSentTurn('steer')
    controller.applyLayout()

    expect(controller.mode).toEqual({ kind: 'new-turn', key: 'steer', top: TOP })
    expect(viewport.rowTop('steer')).toBe(TOP)
  })

  it('leaves a reader inside the turn where they are when a steer arrives', () => {
    const { viewport, controller, scrollUp } = reservedTurn()
    scrollUp(150)

    viewport.setRows([...rows(10), ['sent', 60], ['reply', 100], ['steer', 40]])
    controller.reconcileSentTurn('steer')
    controller.applyLayout()

    expect(controller.mode.kind).toBe('anchored')
    expect(viewport.rowTop('sent')).toBe(TOP + 150)
  })
})
