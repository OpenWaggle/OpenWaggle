import { Effect } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionTitleGenerationError } from '../../errors'
import {
  recoverPendingSessionTitleRefinements,
  refineSessionTitle,
  regenerateSessionTitle,
} from '../session-title-service'
import {
  json,
  resetWorld,
  run,
  SESSION_ID,
  TestLayer,
  text,
  world,
} from './session-title-service.test-harness'

vi.mock('../../session-host/session-host-events', async () => ({
  publishSessionHostEvent: (await import('./session-title-service.test-harness'))
    .publishSessionHostEventMock,
}))

beforeEach(() => {
  resetWorld()
})

describe('refineSessionTitle', () => {
  beforeEach(() => {
    resetWorld({ title: 'Screenshot review', source: 'generated', needsRefinement: true })
  })

  it('waits for the first turn to answer before spending the refinement', async () => {
    world().messages = [text('user', 'look at this', 'u1')]

    await run(refineSessionTitle(SESSION_ID))

    expect(world().requests).toEqual([])
    expect(world().state.needsRefinement).toBe(true)
  })

  it('settles without a request once the user sent a second message', async () => {
    world().messages = [
      text('user', 'look at this', 'u1'),
      text('assistant', 'It is the sidebar.', 'a1'),
      text('user', 'fix it', 'u2'),
    ]

    await run(refineSessionTitle(SESSION_ID))

    expect(world().requests).toEqual([])
    expect(world().cleared).toEqual([SESSION_ID])
  })

  it('happens at most once, even when the request fails', async () => {
    world().messages = [
      text('user', 'look at this', 'u1'),
      text('assistant', 'Sidebar rows.', 'a1'),
    ]
    world().replies.push(
      new SessionTitleGenerationError({ reason: 'request-failed', message: 'x' }),
    )

    await run(refineSessionTitle(SESSION_ID))
    await run(refineSessionTitle(SESSION_ID))

    expect(world().requests).toHaveLength(1)
    expect(world().state).toMatchObject({ title: 'Screenshot review', needsRefinement: false })
  })

  it('is resumed after a Host restart', async () => {
    world().messages = [
      text('user', 'look at this', 'u1'),
      text('assistant', 'Sidebar rows.', 'a1'),
    ]
    world().replies.push(json('Fix sidebar row overlap'))

    await run(recoverPendingSessionTitleRefinements)

    expect(world().state).toMatchObject({
      title: 'Fix sidebar row overlap',
      needsRefinement: false,
    })
  })
})

describe('regenerateSessionTitle', () => {
  beforeEach(() => {
    resetWorld({ title: 'Old manual title', source: 'manual' })
    world().messages = [text('user', 'Make titles short', 'u1'), text('assistant', 'Done.', 'a1')]
  })

  it('applies a new title directly, even over a manual one', async () => {
    world().replies.push(json('Generated session titles'))

    const result = await run(regenerateSessionTitle(SESSION_ID))

    expect(result).toEqual({ outcome: 'renamed', title: 'Generated session titles' })
    expect(world().state).toMatchObject({ title: 'Generated session titles', source: 'generated' })
    expect(world().requests[0]?.systemPrompt).toContain(
      'The previous title was "Old manual title".',
    )
  })

  it('reports an accurate previous title as unchanged', async () => {
    world().replies.push(json('Old manual title'))

    expect(await run(regenerateSessionTitle(SESSION_ID))).toEqual({
      outcome: 'unchanged',
      title: 'Old manual title',
    })
  })

  it('is superseded by a rename made while it runs', async () => {
    world().replies.push(json('Generated'))
    world().duringGeneration = () => {
      world().state = { ...world().state, title: 'Newer rename' }
    }

    expect(await run(regenerateSessionTitle(SESSION_ID))).toEqual({ outcome: 'superseded' })
    expect(world().state.title).toBe('Newer rename')
  })

  it('reports why it could not run', async () => {
    world().titleModel = 'off'
    expect(await run(regenerateSessionTitle(SESSION_ID))).toEqual({
      outcome: 'unavailable',
      reason: 'off',
    })

    world().titleModel = 'automatic'
    world().messages = []
    expect(await run(regenerateSessionTitle(SESSION_ID))).toEqual({
      outcome: 'unavailable',
      reason: 'empty',
    })

    world().messages = [text('user', 'Hello', 'u1')]
    world().replies.push(new SessionTitleGenerationError({ reason: 'no-model', message: 'none' }))
    expect(await run(regenerateSessionTitle(SESSION_ID))).toEqual({
      outcome: 'unavailable',
      reason: 'no-model',
    })

    world().replies.push(
      new SessionTitleGenerationError({ reason: 'request-failed', message: '429 rate limited' }),
    )
    expect(await run(regenerateSessionTitle(SESSION_ID))).toEqual({
      outcome: 'failed',
      message: '429 rate limited',
    })
  })

  it('refuses a second regeneration of the same Session while one runs', async () => {
    world().replies.push(json('First'))
    let concurrent: unknown
    world().duringGeneration = () => {
      world().duringGeneration = undefined
      concurrent = Effect.runSync(
        regenerateSessionTitle(SESSION_ID).pipe(Effect.provide(TestLayer)),
      )
    }

    await run(regenerateSessionTitle(SESSION_ID))

    expect(concurrent).toEqual({ outcome: 'unavailable', reason: 'busy' })
  })
})
