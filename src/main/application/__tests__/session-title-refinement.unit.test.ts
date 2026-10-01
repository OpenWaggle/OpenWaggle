import { Effect, Fiber, TestClock, TestContext } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionTitleGenerationError } from '../../errors'
import { recoverSessionTitleWork } from '../session-title-recovery'
import { refineSessionTitle } from '../session-title-refinement'
import { regenerateSessionTitle } from '../session-title-service'
import {
  HANG,
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

  it('settles instead of refining when the first message is older than a day', async () => {
    const dayAndAHalfAgo = Date.now() - 36 * 60 * 60 * 1000
    world().messages = [
      { ...text('user', 'look at this', 'u1'), createdAt: dayAndAHalfAgo },
      text('assistant', 'Sidebar rows.', 'a1'),
    ]

    await run(refineSessionTitle(SESSION_ID))

    expect(world().requests).toEqual([])
    expect(world().state.needsRefinement).toBe(false)
  })

  it('refines a Session created long ago whose first message is recent', async () => {
    resetWorld({
      title: 'Screenshot review',
      source: 'generated',
      needsRefinement: true,
      updatedAt: Date.now(),
    })
    world().messages = [
      { ...text('user', 'look at this', 'u1'), createdAt: Date.now() },
      text('assistant', 'Sidebar rows overlap.', 'a1'),
    ]
    world().replies.push(json('Fix sidebar row overlap'))

    await run(refineSessionTitle(SESSION_ID))

    expect(world().state.title).toBe('Fix sidebar row overlap')
  })

  it('reads and resumes nothing on a Host restart while the Title model is Off', async () => {
    resetWorld({ title: 'make titles short', source: 'provisional' })
    world().messages = [text('user', 'make titles short', 'u1')]
    world().titleModel = 'off'

    await run(recoverSessionTitleWork)

    expect(world().requests).toEqual([])
    expect(world().state.source).toBe('provisional')
  })

  it('runs a trigger that arrived during a refinement once it finishes', async () => {
    // The first pass reads a transcript whose first turn has not answered yet.
    world().messages = [text('user', 'look at this', 'u1')]
    world().replies.push(json('Fix sidebar row overlap'))
    world().duringRead = () => {
      world().duringRead = undefined
      // The answer lands and its Run ends while the first pass holds the claim.
      world().messages = [
        text('user', 'look at this', 'u1'),
        text('assistant', 'Sidebar rows overlap.', 'a1'),
      ]
      Effect.runSync(refineSessionTitle(SESSION_ID).pipe(Effect.provide(TestLayer)))
    }

    await run(refineSessionTitle(SESSION_ID))

    expect(world().requests).toHaveLength(1)
    expect(world().state).toMatchObject({
      title: 'Fix sidebar row overlap',
      needsRefinement: false,
    })
  })

  it('resumes a Provisional title a Host restart cut off', async () => {
    resetWorld({ title: 'make titles short', source: 'provisional' })
    world().messages = [text('user', 'make titles short', 'u1')]
    world().replies.push(json('Short session titles'))

    await run(recoverSessionTitleWork)

    expect(world().state).toMatchObject({ title: 'Short session titles', source: 'generated' })
  })

  it('is resumed after a Host restart', async () => {
    world().messages = [
      text('user', 'look at this', 'u1'),
      text('assistant', 'Sidebar rows.', 'a1'),
    ]
    world().replies.push(json('Fix sidebar row overlap'))

    await run(recoverSessionTitleWork)

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

  it('gives up after a minute when the Title model never answers', async () => {
    world().replies.push(HANG)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(regenerateSessionTitle(SESSION_ID))
        yield* TestClock.adjust('61 seconds')
        return yield* Fiber.join(fiber)
      }).pipe(Effect.provide(TestLayer), Effect.provide(TestContext.TestContext)),
    )

    expect(result).toEqual({
      outcome: 'failed',
      message: 'The Title model did not answer in time.',
    })
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
