import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { SessionId } from '@shared/types/brand'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activities: vi.fn<() => readonly { readonly sessionId: string }[]>(() => []),
  dispatch: vi.fn<(input: { readonly payload: unknown; readonly caller?: unknown }) => unknown>(),
}))

vi.mock('../host-ui-agent-operation', () => ({
  listHostUiActiveActivities: () => Effect.sync(() => mocks.activities()),
}))
vi.mock('../local-session-command-dispatcher', () => ({
  dispatchLocalSessionCommand: (input: { readonly payload: unknown }) =>
    Effect.suspend(() => {
      try {
        return Effect.succeed(mocks.dispatch(input))
      } catch (error) {
        return Effect.fail(error)
      }
    }),
}))
vi.mock('../../logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { HOST_SHUTDOWN_CALLER_ID } from '../../domain/session-control/root-session-project-reach'
import { interruptAllSessionRuns } from '../session-run-interruption'

// The dispatcher is mocked, so the services its type names are never used.
function runWithoutRequirements(effect: Effect.Effect<void, unknown, unknown>) {
  return Effect.runPromise(fromAny<Effect.Effect<void, unknown>, typeof effect>(effect))
}

const sessionTargetSchema = Schema.Struct({
  sessionId: Schema.optionalWith(Schema.Unknown, { exact: true }),
})

/** The members of a dispatched command payload these tests read. */
const dispatchedPayloadSchema = Schema.Struct({
  contract: Schema.optionalWith(Schema.Unknown, { exact: true }),
  request: Schema.optionalWith(
    Schema.Struct({
      requestId: Schema.optionalWith(Schema.Unknown, { exact: true }),
      query: Schema.optionalWith(sessionTargetSchema, { exact: true }),
      command: Schema.optionalWith(sessionTargetSchema, { exact: true }),
    }),
    { exact: true },
  ),
})

function dispatchedPayload(payload: unknown) {
  return decodeUnknownOrThrow(dispatchedPayloadSchema, payload)
}

function contract(payload: unknown) {
  return dispatchedPayload(payload).contract
}

function sessionOf(payload: unknown) {
  const { request } = dispatchedPayload(payload)
  return (request?.query ?? request?.command)?.sessionId
}

function statusResponse(activeRunId: string | null) {
  return {
    contract: 'session-query-v2',
    response: { outcome: { operation: 'status', activeRunId } },
  }
}

describe('interrupting every Run at a drain deadline', () => {
  beforeEach(() => {
    mocks.activities.mockReset().mockReturnValue([])
    mocks.dispatch.mockReset()
  })

  it('interrupts each Session once, even when one of them cannot be stopped', async () => {
    mocks.activities.mockReturnValue([
      { sessionId: 'session-a' },
      { sessionId: 'session-b' },
      // A Session with both a Run and a compaction counts once.
      { sessionId: 'session-b' },
    ])
    mocks.dispatch.mockImplementation(({ payload }) => {
      if (contract(payload) === 'session-query-v2') {
        if (sessionOf(payload) === 'session-a') throw new Error('Session store is busy')
        return statusResponse('run-b')
      }
      return { contract: 'session-control-v2', response: {} }
    })

    await runWithoutRequirements(interruptAllSessionRuns())

    const interruptCalls = mocks.dispatch.mock.calls
      .map(([input]) => input)
      .filter((input) => contract(input.payload) === 'session-control-v2')
    // The Host stops them itself, so no Run counts as stopped by the desktop user.
    expect(interruptCalls.map((input) => input.caller)).toEqual([
      { callerId: HOST_SHUTDOWN_CALLER_ID },
    ])
    const interrupts = interruptCalls.map((input) => input.payload)
    expect(interrupts).toHaveLength(1)
    expect(interrupts[0]).toMatchObject({
      request: {
        command: {
          operation: 'interrupt',
          sessionId: SessionId('session-b'),
          expectedRunId: 'run-b',
        },
      },
    })
  })

  it('cancels a standalone compaction when the Session has no active Run', async () => {
    mocks.activities.mockReturnValue([{ sessionId: 'session-c' }])
    mocks.dispatch.mockImplementation(({ payload }) => {
      if (contract(payload) === 'session-query-v2') return statusResponse(null)
      return {
        contract: 'local-compaction-cancel-v1',
        response: {
          requestId: dispatchedPayload(payload).request?.requestId,
          sessionId: 'session-c',
        },
      }
    })

    await runWithoutRequirements(interruptAllSessionRuns())

    expect(mocks.dispatch.mock.calls.map(([input]) => contract(input.payload))).toEqual([
      'session-query-v2',
      'local-compaction-cancel-v1',
    ])
  })
})
