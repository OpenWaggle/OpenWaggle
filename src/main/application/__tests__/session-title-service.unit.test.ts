import { SupportedModelId } from '@shared/types/brand'
import { Effect, Fiber, TestClock, TestContext } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionTitleGenerationError } from '../../errors'
import { generateInitialSessionTitle } from '../session-title-service'
import {
  json,
  publishSessionHostEventMock,
  resetWorld,
  run,
  SESSION_ID,
  SESSION_MODEL,
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

describe('generateInitialSessionTitle', () => {
  it('replaces the Provisional title and leaves recency to the repository', async () => {
    world().replies.push(json('Generated session titles'))

    await run(generateInitialSessionTitle({ sessionId: SESSION_ID, text: 'I would like...' }))

    expect(world().state).toMatchObject({ title: 'Generated session titles', source: 'generated' })
    expect(world().requests[0]).toMatchObject({
      sessionModel: SESSION_MODEL,
      titleModel: 'automatic',
      prompt: 'User message:\nI would like...',
    })
    expect(publishSessionHostEventMock).toHaveBeenCalledWith({
      kind: 'session-list-changed',
      sessionId: SESSION_ID,
      change: 'updated',
    })
  })

  it('prefers the Run model and passes a selected Title model through', async () => {
    world().titleModel = SupportedModelId('openai/gpt-nano')
    world().replies.push(json('Title'))
    const runModel = SupportedModelId('anthropic/claude-sonnet')

    await run(generateInitialSessionTitle({ sessionId: SESSION_ID, text: 'x', model: runModel }))

    expect(world().requests[0]).toMatchObject({
      sessionModel: runModel,
      titleModel: 'openai/gpt-nano',
    })
  })

  it('does nothing when the Title model is Off', async () => {
    world().titleModel = 'off'

    await run(generateInitialSessionTitle({ sessionId: SESSION_ID, text: 'Hello' }))

    expect(world().requests).toEqual([])
    expect(world().state.source).toBe('provisional')
  })

  it('never replaces a manual title', async () => {
    resetWorld({ source: 'manual', title: 'My name' })

    await run(generateInitialSessionTitle({ sessionId: SESSION_ID, text: 'Hello' }))

    expect(world().requests).toEqual([])
    expect(world().state.title).toBe('My name')
  })

  it('keeps a rename that lands while the model is generating', async () => {
    world().replies.push(json('Generated title'))
    world().duringGeneration = () => {
      world().state = { ...world().state, title: 'Renamed by me', source: 'manual' }
    }

    await run(generateInitialSessionTitle({ sessionId: SESSION_ID, text: 'Hello' }))

    expect(world().state).toMatchObject({ title: 'Renamed by me', source: 'manual' })
    expect(publishSessionHostEventMock).not.toHaveBeenCalled()
  })

  it('keeps the title when no model is available, without retrying or trying again later', async () => {
    const provisional = world().state.title
    world().replies.push(new SessionTitleGenerationError({ reason: 'no-model', message: 'none' }))

    await run(generateInitialSessionTitle({ sessionId: SESSION_ID, text: 'Hello' }))

    expect(world().requests).toHaveLength(1)
    // Settled, so a Host restart does not spend the request again; a root still owes a refinement.
    expect(world().state).toMatchObject({
      title: provisional,
      source: 'generated',
      needsRefinement: true,
    })
  })

  it('settles a Worker whose title request failed, with no refinement owed', async () => {
    resetWorld({ isWorker: true, title: 'Review the auth module' })
    world().replies.push(new SessionTitleGenerationError({ reason: 'no-model', message: 'none' }))

    await run(
      generateInitialSessionTitle({ sessionId: SESSION_ID, text: 'Review the auth module' }),
    )

    expect(world().state).toMatchObject({
      title: 'Review the auth module',
      source: 'generated',
      needsRefinement: false,
    })
  })

  it('leaves a title requested at creation Provisional when it fails, so the first Run asks again', async () => {
    resetWorld({ isWorker: true, title: 'Review the auth module' })
    world().replies.push(new SessionTitleGenerationError({ reason: 'no-model', message: 'none' }))

    await run(
      generateInitialSessionTitle({
        sessionId: SESSION_ID,
        text: 'Review the auth module',
        settleOnFailure: false,
      }),
    )

    expect(world().state).toMatchObject({ title: 'Review the auth module', source: 'provisional' })
  })

  it('retries a failed request twice with backoff before keeping the Provisional title', async () => {
    const failure = () =>
      new SessionTitleGenerationError({ reason: 'request-failed', message: 'overloaded' })
    world().replies.push(failure(), failure(), json('Third time lucky'))

    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          generateInitialSessionTitle({ sessionId: SESSION_ID, text: 'Hello' }),
        )
        yield* TestClock.adjust('10 seconds')
        yield* Fiber.join(fiber)
      }).pipe(Effect.provide(TestLayer), Effect.provide(TestContext.TestContext)),
    )

    expect(world().requests).toHaveLength(3)
    expect(world().state.title).toBe('Third time lucky')
  })

  it('stops retrying once the Title model is turned Off', async () => {
    world().replies.push(
      new SessionTitleGenerationError({ reason: 'request-failed', message: 'overloaded' }),
    )
    world().duringGeneration = () => {
      world().titleModel = 'off'
    }

    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          generateInitialSessionTitle({ sessionId: SESSION_ID, text: 'Hello' }),
        )
        yield* TestClock.adjust('10 seconds')
        yield* Fiber.join(fiber)
      }).pipe(Effect.provide(TestLayer), Effect.provide(TestContext.TestContext)),
    )

    expect(world().requests).toHaveLength(1)
    expect(world().state.source).toBe('provisional')
  })

  it('titles a first message that is only an attachment and owes it a refinement', async () => {
    resetWorld({ title: 'New session', source: 'default' })
    world().replies.push(json('Screenshot review'))
    const attachments = [{ id: 'a', name: 'sidebar.png', mimeType: 'image/png' }]

    await run(generateInitialSessionTitle({ sessionId: SESSION_ID, text: '', attachments }))

    expect(world().requests[0]?.prompt).toContain('- sidebar.png (image/png)')
    expect(world().state).toMatchObject({ title: 'Screenshot review', needsRefinement: true })
  })

  it('owes a root one refinement for a vague request and runs it once the turn answered', async () => {
    world().messages = [
      text('user', 'Fix this failing test', 'u1'),
      text('assistant', 'The lazy feed test expects a full body.', 'a1'),
    ]
    world().replies.push(json('Fix failing test', true), json('Fix lazy feed test'))

    await run(generateInitialSessionTitle({ sessionId: SESSION_ID, text: 'Fix this failing test' }))

    expect(world().state).toMatchObject({ title: 'Fix lazy feed test', needsRefinement: false })
    expect(world().requests[1]?.systemPrompt).toContain(
      'The previous title was "Fix failing test".',
    )
  })

  it('keeps the Provisional title and owes a refinement when the reply has no usable title', async () => {
    resetWorld({ title: 'hey' })
    world().replies.push(json('New session', true))

    await run(generateInitialSessionTitle({ sessionId: SESSION_ID, text: 'hey' }))

    expect(world().state).toMatchObject({
      title: 'hey',
      source: 'generated',
      needsRefinement: true,
    })
  })

  it('never owes a Worker a refinement', async () => {
    resetWorld({ isWorker: true })
    world().replies.push(json('Review auth module', true))

    await run(
      generateInitialSessionTitle({ sessionId: SESSION_ID, text: 'Review the auth module' }),
    )

    expect(world().state).toMatchObject({ title: 'Review auth module', needsRefinement: false })
    expect(world().requests).toHaveLength(1)
  })
})
