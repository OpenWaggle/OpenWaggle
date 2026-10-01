import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent'
import * as SqlClient from '@effect/sql/SqlClient'
import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promoteSessionFollowUp } from '../../../application/session-control-promotion-service'
import {
  queueSessionFollowUp,
  submitSessionMessage,
} from '../../../application/session-control-service'
import { steerSessionRun } from '../../../application/session-control-steering-service'
import { takeUndeliveredSteers } from '../../../application/undelivered-steering-settlement'
import { SessionControlAttachmentService } from '../../../ports/session-control-attachment-service'
import type { SessionControlTerminalRunStatus } from '../../../ports/session-control-run-lifecycle-repository'
import { SessionControlRunLifecycleRepository } from '../../../ports/session-control-run-lifecycle-repository'
import { makeSessionControlRunLifecycleTestLayer } from '../../__tests__/sqlite-session-control-run-lifecycle-test-layer'
import { SqliteSessionControlOperationJournalLive } from '../../sqlite-session-control-operation-journal'
import { registerPiLiveRun } from '../agent-kernel/pi-live-run-registry'
import { PiAgentSteeringServiceLive } from '../pi-agent-steering-adapter'
import type { PiModel } from '../pi-provider-catalog'

type SessionEvent = Parameters<Parameters<AgentSession['subscribe']>[0]>[0]
type UserMessage = Extract<SessionEvent, { type: 'message_start' }>['message']

const SESSION_ID = 'session-target'
const RUN_ID = 'run-next'

function envelope(key: string) {
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: `request-${key}`,
    idempotencyKey: `idempotency-${key}`,
  }
}

function liveSession() {
  const listeners = new Set<Parameters<AgentSession['subscribe']>[0]>()
  const entries: SessionEntry[] = []
  const steer = vi.fn(async (text: string) => text)
  const session = fromPartial<AgentSession>({
    isStreaming: true,
    isCompacting: false,
    steer,
    getSteeringMessages: () => [],
    subscribe: (listener: Parameters<AgentSession['subscribe']>[0]) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    sessionManager: { getEntries: () => entries, appendCustomEntry: vi.fn() },
  })
  const emit = (type: 'message_start' | 'message_end', message: UserMessage) => {
    for (const listener of listeners) listener(fromPartial<SessionEvent>({ type, message }))
  }
  return {
    session,
    steer,
    incorporate: (text: string) => {
      const message = fromPartial<UserMessage>({ role: 'user', content: [{ type: 'text', text }] })
      emit('message_start', message)
      emit('message_end', message)
      entries.push(fromPartial<SessionEntry>({ type: 'message', message }))
    },
  }
}

function makeRuntime(databasePath: string) {
  let followUpCount = 0
  const sessionControl = makeSessionControlRunLifecycleTestLayer(databasePath, {
    nextFollowUpId: Effect.sync(() => {
      followUpCount += 1
      return FollowUpId(`follow-up-${followUpCount}`)
    }),
  })
  return ManagedRuntime.make(
    Layer.mergeAll(
      SqliteSessionControlOperationJournalLive.pipe(Layer.provideMerge(sessionControl)),
      Layer.succeed(SessionControlAttachmentService, {
        prepare: () => Effect.succeed([]),
        bind: () => Effect.void,
        cleanupUnreferenced: () => Effect.void,
        resolve: () => Effect.succeed([]),
        release: () => Effect.void,
      }),
      PiAgentSteeringServiceLive,
    ),
  )
}

/** A live Run with Follow-ups `follow-up-2` and `follow-up-3` (the start takes `follow-up-1`). */
function startRunWithFollowUps() {
  return Effect.gen(function* () {
    yield* submitSessionMessage({
      callerId: 'local-user',
      request: {
        ...envelope('start'),
        command: {
          operation: 'message',
          sessionId: SESSION_ID,
          input: { text: 'Work.', attachmentIds: [] },
        },
      },
    })
    for (const [key, text] of [
      ['first', 'Queued first.'],
      ['second', 'Promoted while running.'],
    ] as const) {
      yield* queueSessionFollowUp({
        callerId: 'local-user',
        request: {
          ...envelope(key),
          command: {
            operation: 'follow-up',
            sessionId: SESSION_ID,
            input: { text, attachmentIds: [] },
          },
        },
      })
    }
    const lifecycle = yield* SessionControlRunLifecycleRepository
    yield* lifecycle.activate({ sessionId: SessionId(SESSION_ID), runId: RunId(RUN_ID) })
  })
}

function directSteer(text: string) {
  return steerSessionRun({
    callerId: 'session-agent:queen',
    request: {
      ...envelope('direct-steer'),
      command: {
        operation: 'steer',
        sessionId: SESSION_ID,
        expectedRunId: RUN_ID,
        input: { text, attachmentIds: [] },
      },
    },
  })
}

function settle(terminalStatus: SessionControlTerminalRunStatus) {
  return Effect.gen(function* () {
    const lifecycle = yield* SessionControlRunLifecycleRepository
    const undeliveredSteers = yield* takeUndeliveredSteers(RunId(RUN_ID))
    const settlement = yield* lifecycle.settle({
      sessionId: SessionId(SESSION_ID),
      runId: RunId(RUN_ID),
      nextRunId: RunId('run-after'),
      terminalStatus,
      undeliveredSteers,
    })
    const sql = yield* SqlClient.SqlClient
    const [state] = yield* sql<{ readonly queue_state: string; readonly pause: string | null }>`
      SELECT queue_state, queue_pause_reason AS pause FROM session_control_states
    `
    const followUps = yield* sql<{ readonly id: string; readonly intent_json: string }>`
      SELECT id, intent_json FROM session_follow_ups ORDER BY position
    `
    return {
      settlement,
      state,
      queue: followUps.map((row) => ({ id: row.id, ...JSON.parse(row.intent_json) })),
    }
  })
}

describe('Undelivered steering messages through Session Control and Pi run control', () => {
  let temporaryRoot = ''
  let unregister: (() => void) | undefined

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-undelivered-flow-'))
  })

  afterEach(async () => {
    unregister?.()
    unregister = undefined
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('returns a direct steer and a pending promotion to the front of the queue on Stop', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'stop.sqlite'))
    const live = liveSession()
    await runtime.runPromise(startRunWithFollowUps())
    unregister = registerPiLiveRun({
      runId: RUN_ID,
      session: live.session,
      model: fromPartial<PiModel>({ input: ['text'] }),
    })

    const steered = await runtime.runPromise(directSteer('Also check the rollback.'))
    expect(steered.outcome).toMatchObject({ operation: 'steer', effect: 'steered-run' })
    const promotion = runtime.runPromise(
      promoteSessionFollowUp({
        callerId: 'local-user',
        request: {
          ...envelope('promote'),
          command: {
            operation: 'promote',
            sessionId: SESSION_ID,
            expectedRunId: RUN_ID,
            followUpId: 'follow-up-3',
          },
        },
      }),
    )
    await vi.waitFor(() => expect(live.steer).toHaveBeenCalledTimes(2))
    // Stop: Pi aborts without incorporating either steer and the Run's live control ends.
    unregister()
    unregister = undefined
    await expect(promotion).resolves.toMatchObject({ outcome: { effect: 'rejected' } })

    const result = await runtime.runPromise(settle('interrupted'))
    await runtime.dispose()

    expect(result.settlement).toMatchObject({ accepted: true })
    expect(result.state).toEqual({ queue_state: 'paused', pause: 'run-interrupted' })
    expect(result.queue).toEqual([
      {
        id: 'follow-up-4',
        text: 'Also check the rollback.',
        attachmentIds: [],
        callerId: 'session-agent:queen',
        acceptedAt: 1234,
        idempotencyKey: 'idempotency-direct-steer',
      },
      expect.objectContaining({ id: 'follow-up-3', text: 'Promoted while running.' }),
      expect.objectContaining({ id: 'follow-up-2', text: 'Queued first.' }),
    ])
  })

  it('returns nothing when Pi incorporated the steer before the Run completed', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'completed.sqlite'))
    const live = liveSession()
    await runtime.runPromise(startRunWithFollowUps())
    unregister = registerPiLiveRun({
      runId: RUN_ID,
      session: live.session,
      model: fromPartial<PiModel>({ input: ['text'] }),
    })

    await runtime.runPromise(directSteer('Also check the rollback.'))
    live.incorporate('Also check the rollback.')
    unregister()
    unregister = undefined

    const result = await runtime.runPromise(settle('completed'))
    await runtime.dispose()

    expect(result.settlement).toMatchObject({
      accepted: true,
      scheduled: { followUpId: 'follow-up-2' },
    })
    expect(result.queue.map((item) => item.id)).toEqual(['follow-up-3'])
  })
})
