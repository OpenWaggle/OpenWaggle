import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Runtime from 'effect/Runtime'
import * as Schedule from 'effect/Schedule'
import { describe, expect, it } from 'vitest'
import { seedHiveWorker } from '../../adapters/__tests__/hive-worker-cleanup-fixture'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import {
  SessionControlRunExecutor,
  type SessionControlRunExecutorShape,
} from '../../ports/session-control-run-executor'
import { sessionCommandFailureMessage } from '../../session-host/session-command-failure-message'
import { dispatchAdmittedSessionControlCommand } from '../local-session-command-dispatcher'
import {
  archived,
  archiveStateJournal,
  commandHostLayer,
  controlCommandAs,
  seedQueenAuthority,
  useHiveHostTestContext,
  waitForSessionIdle,
} from './hive-worker-cleanup-host.test-harness'
import { authorizationLayer, controlPayload } from './local-session-command-dispatcher.test-support'

/** The Hive tool's archive call, once the Host admitted it, for the agent of Run `runId`. */
function archiveCommand(input: { readonly sessionId: string; readonly runId: string }) {
  return dispatchAdmittedSessionControlCommand({
    caller: { callerId: `session-agent:${input.sessionId}:${input.runId}` },
    payload: controlPayload({ operation: 'archive', sessionId: input.sessionId }),
  })
}

type HostContext =
  | Effect.Effect.Context<ReturnType<typeof archiveCommand>>
  | Layer.Layer.Success<ReturnType<typeof commandHostLayer>>

interface ObservedRun {
  toolResult?: unknown
  abortedDuringRun?: boolean
  archivedDuringRun?: boolean
  finalResponse?: string
}

/**
 * The Hive tool's archive call: the admitted Session Control command on its own fiber, which the
 * Run's abort signal interrupts, with a failure turned into the text the tool returns.
 */
function hiveToolArchive(
  runtime: Runtime.Runtime<HostContext>,
  input: { readonly sessionId: string; readonly runId: string; readonly signal: AbortSignal },
) {
  return Runtime.runPromise(runtime)(archiveCommand(input), { signal: input.signal }).then(
    (result) => result.response.outcome,
    (error: unknown) => sessionCommandFailureMessage(error),
  )
}

/**
 * A Run whose agent archives its own Session, then writes one more line. Like Pi, the Run waits
 * for the tool call to return before it can end, even after its abort signal fires.
 */
function selfArchivingExecutor(
  runtime: () => Runtime.Runtime<HostContext>,
  observed: ObservedRun,
): SessionControlRunExecutorShape {
  return {
    execute: ({ sessionId, runId, controller }) =>
      Effect.promise(async () => {
        observed.toolResult = await hiveToolArchive(runtime(), {
          sessionId,
          runId,
          signal: controller.signal,
        })
        observed.abortedDuringRun = controller.signal.aborted
        observed.archivedDuringRun = await Runtime.runPromise(runtime())(
          Effect.flatMap(SqlClient.SqlClient, (sql) => archived(sql, sessionId)),
        )
        if (controller.signal.aborted) return { terminalStatus: 'interrupted' } as const
        observed.finalResponse = 'No actionable issues today.'
        return { terminalStatus: 'completed', finalResponse: observed.finalResponse } as const
      }),
  }
}

function waitForArchived(sql: SqlClient.SqlClient, sessionId: string) {
  return archived(sql, sessionId).pipe(
    Effect.flatMap((isArchived) =>
      isArchived ? Effect.void : Effect.fail('not-archived' as const),
    ),
    Effect.retry(Schedule.spaced('10 millis').pipe(Schedule.upTo('5 seconds'))),
  )
}

describe('a Session agent archiving its own Session', () => {
  const host = useHiveHostTestContext('openwaggle-self-archive-')

  it('defers the archive until its Run ends instead of interrupting the Run', async () => {
    const observed: ObservedRun = {}
    let hostRuntime: Runtime.Runtime<HostContext> | undefined
    const runtime = () => {
      if (!hostRuntime) throw new Error('The Host runtime is not ready.')
      return hostRuntime
    }
    const layer = Layer.mergeAll(
      commandHostLayer(path.join(host.temporaryRoot, 'self-archive.sqlite')),
      authorizationLayer,
      Layer.succeed(
        SessionControlAttachmentService,
        fromPartial({
          resolve: () => Effect.succeed([]),
          release: () => Effect.void,
          cleanupUnreferenced: () => Effect.void,
        }),
      ),
      Layer.succeed(SessionControlRunExecutor, selfArchivingExecutor(runtime, observed)),
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        hostRuntime = yield* Effect.runtime<HostContext>()
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql, { state: 'working' })
        yield* seedQueenAuthority(sql, host.temporaryRoot)
        const started = yield* controlCommandAs('gui:local-user', 'user-starts-queen', {
          operation: 'start',
          sessionId: 'queen',
          input: { text: "Triage today's issues.", attachmentIds: [] },
        })
        if (started.outcome.effect !== 'started-run') throw new Error('The Run did not start.')
        // Before the fix the archive waited out its 30 s settle bound for a Run that was waiting
        // for it, so a red run takes that long to show what the tool returned.
        yield* Effect.suspend(() =>
          observed.toolResult === undefined ? Effect.fail('tool-pending' as const) : Effect.void,
        ).pipe(Effect.retry(Schedule.spaced('10 millis').pipe(Schedule.upTo('40 seconds'))))
        yield* waitForSessionIdle('queen')
        const archivedAfterRun = yield* waitForArchived(sql, 'queen').pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        )
        const runs = yield* sql<{ readonly status: string }>`
          SELECT status FROM session_runs WHERE id = ${started.outcome.runId}
        `
        return {
          runId: started.outcome.runId,
          archivedAfterRun,
          runStatus: runs[0]?.status,
          journal: yield* archiveStateJournal(sql, 'queen'),
        }
      }).pipe(Effect.provide(layer)),
    )

    expect(observed).toEqual({
      toolResult: {
        operation: 'archive',
        effect: 'session-archive-deferred',
        sessionId: 'queen',
        runId: result.runId,
      },
      abortedDuringRun: false,
      archivedDuringRun: false,
      finalResponse: 'No actionable issues today.',
    })
    expect(result.archivedAfterRun).toBe(true)
    expect(result.runStatus).toBe('completed')
    expect(result.journal).toEqual([
      { caller_id: `session-agent:queen:${result.runId}`, operation: 'archive' },
    ])
    expect(host.events).toContainEqual({
      kind: 'session-list-changed',
      sessionId: 'queen',
      change: 'archived',
    })
  }, 45_000)
})
