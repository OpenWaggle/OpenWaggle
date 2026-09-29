import { describe, expect, it } from 'vitest'
import {
  NEW_TURN_TOP_OFFSET_PX,
  TranscriptViewportController,
} from '../transcript-viewport-controller'
import { fakeViewport, keysOf, rowIndex, rows } from './transcript-viewport.fixtures'

const TOP = NEW_TURN_TOP_OFFSET_PX

/** A sent turn with a short reply, still reserving space below it. */
function reservedTurn(sentKey = 'sent') {
  const viewport = fakeViewport([...rows(10), [sentKey, 60], ['reply', 100]])
  const controller = new TranscriptViewportController(viewport.geometry)
  controller.anchorNewTurn(sentKey, 'row-9')
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

    const swapped: Array<[string, number]> = [...rows(10), ['persisted', 60], ['reply', 100]]
    viewport.setRows(swapped)
    controller.syncRows(rowIndex(keysOf(swapped), { users: ['persisted'] }))
    controller.applyLayout()

    expect(controller.mode).toEqual({ kind: 'new-turn', key: 'persisted', top: TOP })
    expect(viewport.rowTop('persisted')).toBe(TOP)
  })

  it('keeps the reserved space when the message persists under a reader inside the turn', () => {
    const { viewport, controller, scrollUp } = reservedTurn('optimistic')
    scrollUp(150)

    const swapped: Array<[string, number]> = [...rows(10), ['persisted', 60], ['reply', 100]]
    viewport.setRows(swapped)
    controller.syncRows(rowIndex(keysOf(swapped), { users: ['persisted'] }))
    controller.applyLayout()

    expect(viewport.rowTop('persisted')).toBe(TOP + 150)
    expect(viewport.endSpace).toBe(500 - TOP - 160)
  })

  it('pairs the persisted copy by position, not by being the latest user message', () => {
    const { viewport, controller } = reservedTurn('optimistic')

    // The run completes with a steer inside the turn: the steer is now the latest user message.
    const swapped: Array<[string, number]> = [
      ...rows(10),
      ['persisted', 60],
      ['reply', 100],
      ['steer', 40],
    ]
    viewport.setRows(swapped)
    controller.syncRows(rowIndex(keysOf(swapped), { users: ['persisted', 'steer'] }))
    controller.applyLayout()

    expect(controller.sentTurnKey).toBe('persisted')
    expect(viewport.rowTop('persisted')).toBe(TOP)
  })

  it('does not hold the previous message when the sent one is withdrawn', () => {
    const list: Array<[string, number]> = [
      ['u1', 60],
      ['a1', 900],
      ['sent', 60],
    ]
    const viewport = fakeViewport(list)
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.anchorNewTurn('sent', 'a1')

    // A refused or queued send removes its optimistic row; the previous turn is all that is left.
    const withdrawn: Array<[string, number]> = [
      ['u1', 60],
      ['a1', 900],
    ]
    viewport.setRows(withdrawn)
    controller.syncRows(rowIndex(keysOf(withdrawn), { users: ['u1'] }))
    controller.applyLayout()
    controller.applyLayout()

    expect(controller.sentTurnKey).toBeNull()
    expect(controller.isFollowing).toBe(true)
    expect(viewport.scrollTop).toBe(viewport.maxScrollTop())
  })

  it('pairs the persisted copy after the row before it was re-keyed during the turn', () => {
    const list: Array<[string, number]> = [
      ['u1', 60],
      ['a-stream', 100],
      ['sent', 60],
    ]
    const viewport = fakeViewport(list)
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.anchorNewTurn('sent', 'a-stream')

    // The previous run's snapshot refresh re-keys its answer while the sent message is held.
    const refreshed: Array<[string, number]> = [
      ['u1', 60],
      ['a-persisted', 100],
      ['sent', 60],
    ]
    viewport.setRows(refreshed)
    controller.syncRows(rowIndex(keysOf(refreshed), { users: ['u1', 'sent'] }))

    const swapped: Array<[string, number]> = [
      ['u1', 60],
      ['a-persisted', 100],
      ['sent-p', 60],
    ]
    viewport.setRows(swapped)
    controller.syncRows(rowIndex(keysOf(swapped), { users: ['u1', 'sent-p'] }))
    controller.applyLayout()

    expect(controller.sentTurnKey).toBe('sent-p')
    expect(viewport.rowTop('sent-p')).toBe(TOP)
  })

  it('keeps holding the sent message when a steer arrives inside its turn', () => {
    const { viewport, controller } = reservedTurn()

    const steered: Array<[string, number]> = [
      ...rows(10),
      ['sent', 60],
      ['reply', 100],
      ['steer', 40],
    ]
    viewport.setRows(steered)
    controller.syncRows(rowIndex(keysOf(steered), { users: ['sent', 'steer'] }))
    controller.applyLayout()
    expect(controller.mode).toEqual({ kind: 'new-turn', key: 'sent', top: TOP })

    // The running output keeps growing above the steer and stays in view under the message.
    viewport.setRows([...rows(10), ['sent', 60], ['reply', 300], ['steer', 40]])
    controller.applyLayout()
    expect(viewport.rowTop('sent')).toBe(TOP)
    expect(viewport.rowTop('reply')).toBe(TOP + 60)
  })

  it('does not move the reservation to a persisted copy that has no row yet', () => {
    const { viewport, controller } = reservedTurn('optimistic')

    viewport.setRows([...rows(10), ['reply', 100]])
    controller.syncRows(
      rowIndex([...keysOf(rows(10)), 'persisted', 'reply'], { users: ['persisted'] }),
    )

    expect(controller.sentTurnKey).toBe('optimistic')
  })

  it('follows a working turn that crosses the bottom after the reader re-held it', () => {
    const { viewport, controller, scrollUp } = reservedTurn()
    viewport.setRows([...rows(10), ['sent', 60], ['reply', 900]])
    controller.applyLayout()
    scrollUp(100)
    viewport.setRows([...rows(10), ['sent', 60], ['reply', 100]])
    controller.applyLayout()
    viewport.userScrollTo(viewport.maxScrollTop())
    controller.handleScroll()
    expect(controller.isHoldingSentTurn).toBe(true)

    controller.syncRows(rowIndex([], { workAfter: ['sent'] }))
    viewport.setRows([...rows(10), ['sent', 60], ['reply', 700]])
    controller.applyLayout()
    expect(controller.isFollowing).toBe(true)
  })
})
