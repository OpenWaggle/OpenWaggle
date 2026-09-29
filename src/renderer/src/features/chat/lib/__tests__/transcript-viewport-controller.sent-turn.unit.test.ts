import { describe, expect, it } from 'vitest'
import {
  NEW_TURN_TOP_OFFSET_PX,
  TranscriptViewportController,
} from '../transcript-viewport-controller'
import { fakeViewport, rows } from './transcript-viewport.fixtures'

describe('TranscriptViewportController sent turn', () => {
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

  it('holds a sent turn in place once its reply outgrows the viewport', () => {
    const viewport = fakeViewport([...rows(10), ['sent', 60]])
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.anchorNewTurn('sent')

    viewport.setRows([...rows(10), ['sent', 60], ['reply', 900]])
    controller.applyLayout()

    expect(controller.isFollowing).toBe(false)
    expect(controller.isHoldingSentTurn).toBe(true)
    expect(viewport.endSpace).toBe(0)
    expect(viewport.rowTop('sent')).toBe(NEW_TURN_TOP_OFFSET_PX)

    viewport.setRows([...rows(10), ['sent', 60], ['reply', 1500]])
    controller.applyLayout()
    expect(viewport.rowTop('sent')).toBe(NEW_TURN_TOP_OFFSET_PX)
  })

  it('hands a held sent turn over to following when the reader scrolls to the live end', () => {
    const viewport = fakeViewport([...rows(10), ['sent', 60], ['reply', 900]])
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.anchorNewTurn('sent')

    viewport.userScrollTo(viewport.maxScrollTop())
    controller.handleScroll()
    expect(controller.isFollowing).toBe(true)

    viewport.setRows([...rows(10), ['sent', 60], ['reply', 1200]])
    controller.applyLayout()
    expect(viewport.scrollTop).toBe(viewport.maxScrollTop())
  })

  it('treats a clamp at the held sent turn as layout, not the reader leaving', () => {
    const viewport = fakeViewport([...rows(10), ['sent', 60], ['reply', 900]])
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.anchorNewTurn('sent')

    // The reply shrinks (its work folds), and the browser clamps before the next layout runs.
    viewport.setRows([...rows(10), ['sent', 60], ['reply', 100]])
    controller.handleScroll()
    expect(controller.isHoldingSentTurn).toBe(true)

    controller.applyLayout()
    expect(viewport.rowTop('sent')).toBe(NEW_TURN_TOP_OFFSET_PX)
    expect(viewport.endSpace).toBe(500 - NEW_TURN_TOP_OFFSET_PX - 160)
  })

  it('keeps the reserved space under a reader who scrolls up during the reply', () => {
    const viewport = fakeViewport([...rows(10), ['sent', 60], ['reply', 100]])
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.anchorNewTurn('sent')

    viewport.userScrollTo(viewport.scrollTop - 150)
    controller.handleScroll()
    controller.applyLayout()
    const readerTop = NEW_TURN_TOP_OFFSET_PX + 150
    expect(viewport.rowTop('sent')).toBe(readerTop)

    // The reply consumes the reserved space as it grows; the reader's row does not move.
    viewport.setRows([...rows(10), ['sent', 60], ['reply', 200]])
    controller.applyLayout()
    expect(viewport.rowTop('sent')).toBe(readerTop)
    expect(viewport.endSpace).toBe(500 - NEW_TURN_TOP_OFFSET_PX - 260)
  })

  it('returns to the held sent turn when the reader scrolls back into its reserved space', () => {
    const viewport = fakeViewport([...rows(10), ['sent', 60], ['reply', 100]])
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.anchorNewTurn('sent')

    viewport.userScrollTo(viewport.scrollTop - 150)
    controller.handleScroll()
    viewport.userScrollTo(viewport.maxScrollTop())
    controller.handleScroll()

    expect(controller.isHoldingSentTurn).toBe(true)
    controller.applyLayout()
    expect(viewport.rowTop('sent')).toBe(NEW_TURN_TOP_OFFSET_PX)
    expect(viewport.endSpace).toBeGreaterThan(0)
  })

  it('moves the held sent turn to the persisted copy of its message', () => {
    const viewport = fakeViewport([...rows(10), ['optimistic', 60], ['reply', 100]])
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.anchorNewTurn('optimistic')

    viewport.setRows([...rows(10), ['persisted', 60], ['reply', 100]])
    controller.replaceSentTurn('persisted')
    controller.applyLayout()

    expect(controller.sentTurnKey).toBe('persisted')
    expect(controller.mode).toEqual({
      kind: 'new-turn',
      key: 'persisted',
      top: NEW_TURN_TOP_OFFSET_PX,
    })
    expect(viewport.rowTop('persisted')).toBe(NEW_TURN_TOP_OFFSET_PX)
  })

  it('holds what the reader sees when the held sent row leaves the DOM', () => {
    const viewport = fakeViewport([...rows(10), ['sent', 60], ['reply', 900]])
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.anchorNewTurn('sent')
    const scrollTop = viewport.scrollTop

    viewport.setRows([...rows(10), ['other', 60], ['reply', 900]])
    controller.applyLayout()

    expect(controller.mode.kind).toBe('anchored')
    expect(viewport.scrollTop).toBe(scrollTop)
  })
})
