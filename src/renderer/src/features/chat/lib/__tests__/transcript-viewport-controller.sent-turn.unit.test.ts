import { describe, expect, it } from 'vitest'
import {
  NEW_TURN_TOP_OFFSET_PX,
  TranscriptViewportController,
} from '../transcript-viewport-controller'
import { fakeViewport, rows } from './transcript-viewport.fixtures'

const TOP = NEW_TURN_TOP_OFFSET_PX

function sentTurn(reply: number | null, options: { readonly work?: boolean } = {}) {
  const turn: Array<[string, number]> = [['sent', 60]]
  if (reply !== null) turn.push(['reply', reply])
  const viewport = fakeViewport([...rows(10), ...turn])
  const controller = new TranscriptViewportController(viewport.geometry)
  controller.anchorNewTurn('sent')
  controller.setTurnHasWork(options.work ?? false)
  const grow = (height: number) => {
    viewport.setRows([...rows(10), ['sent', 60], ['reply', height]])
    controller.applyLayout()
  }
  return { viewport, controller, grow }
}

describe('TranscriptViewportController sent turn', () => {
  it('pins a sent message near the top and reserves space for the reply', () => {
    const { viewport, grow } = sentTurn(null)
    expect(viewport.rowTop('sent')).toBe(TOP)
    expect(viewport.endSpace).toBe(500 - TOP - 60)

    grow(200)
    expect(viewport.rowTop('sent')).toBe(TOP)
    expect(viewport.endSpace).toBe(500 - TOP - 260)
  })

  it('keeps a working turn held until it reaches the bottom of the viewport', () => {
    const { viewport, controller, grow } = sentTurn(100, { work: true })
    grow(300)
    expect(controller.isHoldingSentTurn).toBe(true)
    expect(viewport.rowTop('sent')).toBe(TOP)
  })

  it('follows a working turn from the moment it reaches the bottom of the viewport', () => {
    const { viewport, controller, grow } = sentTurn(100, { work: true })
    const heldScrollTop = viewport.scrollTop

    grow(900)

    expect(controller.isFollowing).toBe(true)
    expect(viewport.endSpace).toBe(0)
    expect(viewport.scrollTop).toBe(viewport.maxScrollTop())
    // Following starts at the end of the turn, so the view only ever moves toward newer content.
    expect(viewport.scrollTop).toBeGreaterThanOrEqual(heldScrollTop)
  })

  it('holds a plain answer in place once it outgrows the viewport', () => {
    const { viewport, controller, grow } = sentTurn(null)
    grow(900)

    expect(controller.isHoldingSentTurn).toBe(true)
    expect(viewport.endSpace).toBe(0)
    expect(viewport.rowTop('sent')).toBe(TOP)

    grow(1500)
    expect(viewport.rowTop('sent')).toBe(TOP)
  })

  it('follows a held plain answer that starts working only once it reaches the bottom', () => {
    const { viewport, controller, grow } = sentTurn(100)
    controller.setTurnHasWork(true)
    grow(200)
    expect(viewport.rowTop('sent')).toBe(TOP)

    grow(900)
    expect(controller.isFollowing).toBe(true)
  })

  it('keeps holding a plain answer that starts working after it spilled below the fold', () => {
    const { viewport, controller, grow } = sentTurn(100)
    grow(1500)
    expect(controller.isHoldingSentTurn).toBe(true)

    // A tool call arrives while the reader is still reading the answer from its top.
    controller.setTurnHasWork(true)
    grow(1540)

    expect(controller.isHoldingSentTurn).toBe(true)
    expect(viewport.rowTop('sent')).toBe(TOP)
  })

  it('follows a working turn that crosses the bottom again after it shrank back', () => {
    const { controller, grow } = sentTurn(100)
    grow(1500)
    controller.setTurnHasWork(true)
    grow(100)
    expect(controller.isHoldingSentTurn).toBe(true)

    grow(900)
    expect(controller.isFollowing).toBe(true)
  })

  it('never pulls a reader who scrolled away back to a working turn', () => {
    const { viewport, controller, grow } = sentTurn(100, { work: true })
    viewport.userScrollTo(viewport.scrollTop - 150)
    controller.handleScroll()

    grow(900)

    expect(controller.mode.kind).toBe('anchored')
    expect(viewport.rowTop('sent')).toBe(TOP + 150)
  })

  it('keeps the reply of a message taller than the viewport in view', () => {
    const viewport = fakeViewport([...rows(10), ['sent', 800], ['reply', 100]])
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.anchorNewTurn('sent')

    const sentTop = viewport.rowTop('sent') ?? 0
    // The message's bottom sits no lower than 240px, like Codex, leaving the rest for the reply.
    expect(sentTop + 800).toBe(240)
    expect(viewport.rowTop('reply')).toBe(240)
    expect(controller.isHoldingSentTurn).toBe(true)
  })

  it('saves a tall held message at the offset where it actually sits', () => {
    const viewport = fakeViewport([...rows(10), ['sent', 800], ['reply', 900]])
    const controller = new TranscriptViewportController(viewport.geometry)
    controller.anchorNewTurn('sent')

    expect(controller.readingPosition()).toEqual({ key: 'sent', top: 240 - 800 })
  })

  it('hands a held sent turn over to following when the reader scrolls to the live end', () => {
    const { viewport, controller, grow } = sentTurn(900)

    viewport.userScrollTo(viewport.maxScrollTop())
    controller.handleScroll()
    expect(controller.isFollowing).toBe(true)

    grow(1200)
    expect(viewport.scrollTop).toBe(viewport.maxScrollTop())
  })

  it('treats a clamp at the held sent turn as layout, not the reader leaving', () => {
    const { viewport, controller } = sentTurn(900)

    // The reply shrinks (its work folds), and the browser clamps before the next layout runs.
    viewport.setRows([...rows(10), ['sent', 60], ['reply', 100]])
    controller.handleScroll()
    expect(controller.isHoldingSentTurn).toBe(true)

    controller.applyLayout()
    expect(viewport.rowTop('sent')).toBe(TOP)
    expect(viewport.endSpace).toBe(500 - TOP - 160)
  })

  it('saves a held, overflowing sent turn as the reading position', () => {
    const { viewport, controller } = sentTurn(900)
    expect(controller.readingPosition()).toEqual({ key: 'sent', top: TOP })

    viewport.userScrollTo(viewport.maxScrollTop())
    controller.handleScroll()
    expect(controller.readingPosition()).toBeNull()
  })

  it('holds what the reader sees when the held sent row leaves the DOM', () => {
    const { viewport, controller } = sentTurn(900)
    const scrollTop = viewport.scrollTop

    viewport.setRows([...rows(10), ['other', 60], ['reply', 900]])
    controller.applyLayout()

    expect(controller.mode.kind).toBe('anchored')
    expect(viewport.scrollTop).toBe(scrollTop)
    // Its reservation went with it: an older user message must not become the held turn.
    controller.reconcileSentTurn('row-9')
    expect(controller.sentTurnKey).toBeNull()
  })
})
