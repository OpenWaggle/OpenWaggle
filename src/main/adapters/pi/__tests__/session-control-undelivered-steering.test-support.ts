import type { AgentSession, SessionEntry } from '@earendil-works/pi-coding-agent'
import * as SqlClient from '@effect/sql/SqlClient'
import { FollowUpId, RunId, SessionId } from '@shared/types/brand'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as ManagedRuntime from 'effect/ManagedRuntime'
import { vi } from 'vitest'
import {
  queueSessionFollowUp,
  submitSessionMessage,
} from '../../../application/session-control-service'
import { steerSessionRun } from '../../../application/session-control-steering-service'
import { settleWithUndeliveredSteers } from '../../../application/undelivered-steering-settlement'
import { SessionControlAttachmentService } from '../../../ports/session-control-attachment-service'
import type { SessionControlTerminalRunStatus } from '../../../ports/session-control-run-lifecycle-repository'
import { SessionControlRunLifecycleRepository } from '../../../ports/session-control-run-lifecycle-repository'
import { SESSION_HOST_BROWSER_ATTACHMENT_MIGRATION } from '../../../services/session-host-browser-attachment-migration'
import { makeSessionControlRunLifecycleTestLayer } from '../../__tests__/sqlite-session-control-run-lifecycle-test-layer'
import { sessionControlAttachmentServiceLayer } from '../../session-control-attachment-service'
import { SqliteSessionControlOperationJournalLive } from '../../sqlite-session-control-operation-journal'
import { registerPiLiveRun } from '../agent-kernel/pi-live-run-registry'
import { PiAgentSteeringServiceLive } from '../pi-agent-steering-adapter'
import type { PiModel } from '../pi-provider-catalog'

type SessionEvent = Parameters<Parameters<AgentSession['subscribe']>[0]>[0]
type UserMessage = Extract<SessionEvent, { type: 'message_start' }>['message']

export const SESSION_ID = 'session-target'
export const RUN_ID = 'run-next'
export const STEER_CALLER_ID = 'session-agent:queen'

export function envelope(key: string) {
  return {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: `request-${key}`,
    idempotencyKey: `idempotency-${key}`,
  }
}

export function liveSession() {
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
    /** Pi incorporates the steer whose text Pi received in the given call. */
    incorporate: (text: string) => {
      const message = fromPartial<UserMessage>({ role: 'user', content: [{ type: 'text', text }] })
      emit('message_start', message)
      emit('message_end', message)
      entries.push(fromPartial<SessionEntry>({ type: 'message', message }))
    },
    register: () =>
      registerPiLiveRun({
        runId: RUN_ID,
        session,
        model: fromPartial<PiModel>({ input: ['text'] }),
      }),
  }
}

const noAttachments = Layer.succeed(SessionControlAttachmentService, {
  prepare: () => Effect.succeed([]),
  bind: () => Effect.void,
  cleanupUnreferenced: () => Effect.void,
  resolve: () => Effect.succeed([]),
  release: () => Effect.void,
})

/** Real SQLite Session Control and Pi steering, with stored attachments when asked. */
export function makeRuntime(
  databasePath: string,
  options: { readonly storedAttachments?: boolean } = {},
) {
  let followUpCount = 0
  const sessionControl = makeSessionControlRunLifecycleTestLayer(databasePath, {
    nextFollowUpId: Effect.sync(() => {
      followUpCount += 1
      return FollowUpId(`follow-up-${followUpCount}`)
    }),
  })
  const attachmentSchema = Layer.effectDiscard(
    SqlClient.SqlClient.pipe(
      Effect.flatMap((sql) =>
        Effect.forEach(SESSION_HOST_BROWSER_ATTACHMENT_MIGRATION.statements, (statement) =>
          sql.unsafe(statement),
        ),
      ),
    ),
  )
  const attachments = options.storedAttachments
    ? sessionControlAttachmentServiceLayer().pipe(
        Layer.provideMerge(attachmentSchema),
        Layer.provideMerge(sessionControl),
      )
    : Layer.merge(sessionControl, noAttachments)
  return ManagedRuntime.make(
    Layer.mergeAll(
      SqliteSessionControlOperationJournalLive.pipe(Layer.provideMerge(attachments)),
      PiAgentSteeringServiceLive,
    ),
  )
}

/** A live Run with Follow-ups `follow-up-2` and `follow-up-3` (the start takes `follow-up-1`). */
export function startRunWithFollowUps() {
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
    yield* lifecycle.activate({ sessionId: SessionId(SESSION_ID), runId: RUN_ID_BRAND })
  })
}

const RUN_ID_BRAND = RunId(RUN_ID)

export function directSteer(
  text: string,
  options: { readonly key?: string; readonly attachmentIds?: readonly string[] } = {},
) {
  return steerSessionRun({
    callerId: STEER_CALLER_ID,
    request: {
      ...envelope(options.key ?? 'direct-steer'),
      command: {
        operation: 'steer',
        sessionId: SESSION_ID,
        expectedRunId: RUN_ID,
        input: { text, attachmentIds: options.attachmentIds ?? [] },
      },
    },
  })
}

export function readQueueRows() {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [state] = yield* sql<{ readonly queue_state: string; readonly pause: string | null }>`
      SELECT queue_state, queue_pause_reason AS pause FROM session_control_states
    `
    const followUps = yield* sql<{ readonly id: string; readonly intent_json: string }>`
      SELECT id, intent_json FROM session_follow_ups ORDER BY position
    `
    return {
      state,
      queue: followUps.map((row) => ({ id: row.id, ...JSON.parse(row.intent_json) })),
    }
  })
}

/** Settle the Run the way the Run coordinator does, with the steers Pi never incorporated. */
export function settle(terminalStatus: SessionControlTerminalRunStatus) {
  return Effect.gen(function* () {
    const lifecycle = yield* SessionControlRunLifecycleRepository
    const settlement = yield* settleWithUndeliveredSteers({
      sessionId: SessionId(SESSION_ID),
      runId: RUN_ID_BRAND,
      settle: (undeliveredSteers) =>
        lifecycle.settle({
          sessionId: SessionId(SESSION_ID),
          runId: RUN_ID_BRAND,
          nextRunId: RunId('run-after'),
          terminalStatus,
          undeliveredSteers,
        }),
    })
    return { settlement, ...(yield* readQueueRows()) }
  })
}
