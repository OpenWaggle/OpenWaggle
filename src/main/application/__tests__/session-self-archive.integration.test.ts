import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Runtime from 'effect/Runtime'
import * as Schedule from 'effect/Schedule'
import { describe, expect, it } from 'vitest'
import {
  QUEEN_CALLER_ID,
  seedHiveWorker,
} from '../../adapters/__tests__/hive-worker-cleanup-fixture'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import {
  SessionControlRunExecutor,
  type SessionControlRunExecutorShape,
} from '../../ports/session-control-run-executor'
import type { SessionControlTerminalRunStatus } from '../../ports/session-control-run-lifecycle-repository'
import { sessionCommandFailureMessage } from '../../session-host/session-command-failure-message'
import { dispatchAdmittedSessionControlCommand } from '../local-session-command-dispatcher'
import { hasPendingSelfArchive } from '../session-self-archive'
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

const FINAL_RESPONSE = 'No actionable issues today.'

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
  toolResults: unknown[]
  abortedDuringRun?: boolean
  archivedDuringRun?: boolean
}

interface Scenario {
  /** How many times the agent calls archive on its own Session. */
  readonly archiveCalls?: number
  /** What happens after the archive call returns, while the Run is still live. */
  readonly afterArchive?: (runtime: Runtime.Runtime<HostContext>) => Promise<unknown>
  /** How the Run that asked ends. */
  readonly terminalStatus?: SessionControlTerminalRunStatus
  /**
   * An accepted Worker its Queen sent more work, which Hive cleanup archives once that Run ends,
   * instead of a Queen the user started.
   */
  readonly acceptedWorker?: boolean
  /** The Queen's Worker is still working, instead of waiting for the Queen's review. */
  readonly workerStillWorking?: boolean
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
 * The first Run's agent archives its own Session, then writes one more line. Like Pi, the Run
 * waits for the tool call to return before it can end, even after its abort signal fires. Later
 * Runs, such as a queued Follow-up, just complete.
 */
function selfArchivingExecutor(
  runtime: () => Runtime.Runtime<HostContext>,
  observed: ObservedRun,
  scenario: Scenario,
) {
  let runs = 0
  return {
    execute: ({ sessionId, runId, controller }) =>
      Effect.promise(async () => {
        runs += 1
        if (runs > 1) return { terminalStatus: 'completed', finalResponse: 'Follow-up done.' }
        for (let call = 0; call < (scenario.archiveCalls ?? 1); call += 1) {
          observed.toolResults.push(
            await hiveToolArchive(runtime(), { sessionId, runId, signal: controller.signal }),
          )
        }
        await scenario.afterArchive?.(runtime())
        observed.abortedDuringRun = controller.signal.aborted
        observed.archivedDuringRun = await Runtime.runPromise(runtime())(
          Effect.flatMap(SqlClient.SqlClient, (sql) => archived(sql, sessionId)),
        )
        if (controller.signal.aborted) return { terminalStatus: 'interrupted' } as const
        const terminalStatus = scenario.terminalStatus ?? 'completed'
        return terminalStatus === 'completed'
          ? { terminalStatus, finalResponse: FINAL_RESPONSE }
          : { terminalStatus }
      }),
  } satisfies SessionControlRunExecutorShape
}

function waitUntil(check: () => boolean, label: string, timeout: '5 seconds' | '40 seconds') {
  return Effect.suspend(() => (check() ? Effect.void : Effect.fail(label))).pipe(
    Effect.retry(Schedule.spaced('10 millis').pipe(Schedule.upTo(timeout))),
  )
}

function runScenario(databasePath: string, scenario: Scenario) {
  const observed: ObservedRun = { toolResults: [] }
  let hostRuntime: Runtime.Runtime<HostContext> | undefined
  const runtime = () => {
    if (!hostRuntime) throw new Error('The Host runtime is not ready.')
    return hostRuntime
  }
  const layer = Layer.mergeAll(
    commandHostLayer(databasePath),
    authorizationLayer,
    Layer.succeed(
      SessionControlAttachmentService,
      fromPartial({
        resolve: () => Effect.succeed([]),
        release: () => Effect.void,
        cleanupUnreferenced: () => Effect.void,
      }),
    ),
    Layer.succeed(SessionControlRunExecutor, selfArchivingExecutor(runtime, observed, scenario)),
  )
  return Effect.runPromise(
    Effect.gen(function* () {
      hostRuntime = yield* Effect.runtime<HostContext>()
      const sql = yield* SqlClient.SqlClient
      yield* seedHiveWorker(sql, {
        state: scenario.acceptedWorker
          ? 'accepted'
          : scenario.workerStillWorking
            ? 'working'
            : 'ready_for_review',
      })
      yield* seedQueenAuthority(sql, path.dirname(databasePath))
      const target = scenario.acceptedWorker ? 'worker' : 'queen'
      const started = yield* controlCommandAs(
        scenario.acceptedWorker ? QUEEN_CALLER_ID : 'gui:local-user',
        'starts-the-run',
        {
          operation: 'start',
          sessionId: target,
          input: { text: "Triage today's issues.", attachmentIds: [] },
        },
      )
      if (started.outcome.effect !== 'started-run') throw new Error('The Run did not start.')
      // Before the fix the archive waited out its 30 s settle bound for a Run that was waiting
      // for it, so a red run takes that long to show what the tool returned.
      yield* waitUntil(() => observed.archivedDuringRun !== undefined, 'run-pending', '40 seconds')
      yield* waitForSessionIdle(target)
      const archivedAfterRun = yield* archived(sql, target).pipe(
        Effect.flatMap((isArchived) => (isArchived ? Effect.void : Effect.fail('not-archived'))),
        Effect.retry(Schedule.spaced('10 millis').pipe(Schedule.upTo('2 seconds'))),
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      )
      // The deferred archive has decided once nothing is pending for the Session any more.
      yield* waitUntil(() => !hasPendingSelfArchive(SessionId(target)), 'pending', '5 seconds')
      const runs = yield* sql<{ readonly id: string; readonly status: string }>`
        SELECT id, status FROM session_runs
        WHERE session_id = ${target} AND id <> ${`run-${target}`} ORDER BY rowid
      `
      return {
        observed,
        runId: started.outcome.runId,
        archivedAfterRun: archivedAfterRun && (yield* archived(sql, target)),
        runs: runs.map((run) => ({ id: run.id, status: run.status })),
        journal: yield* archiveStateJournal(sql, target),
      }
    }).pipe(Effect.provide(layer)),
  )
}

function deferredOutcome(runId: string, sessionId = 'queen') {
  return {
    operation: 'archive',
    effect: 'session-archive-deferred',
    sessionId,
    runId,
  }
}

describe('a Session agent archiving its own Session', () => {
  const host = useHiveHostTestContext('openwaggle-self-archive-')
  const database = (name: string) => path.join(host.temporaryRoot, `${name}.sqlite`)

  it('defers the archive until its Run ends instead of interrupting the Run', async () => {
    const result = await runScenario(database('self-archive'), {})

    expect(result.observed).toEqual({
      toolResults: [deferredOutcome(result.runId)],
      abortedDuringRun: false,
      archivedDuringRun: false,
    })
    expect(result.archivedAfterRun).toBe(true)
    expect(result.runs).toEqual([{ id: result.runId, status: 'completed' }])
    expect(result.journal).toEqual([
      { caller_id: `session-agent:queen:${result.runId}`, operation: 'archive' },
    ])
    expect(host.events).toContainEqual({
      kind: 'session-list-changed',
      sessionId: 'queen',
      change: 'archived',
    })
  }, 45_000)

  it('records the Worker archive its agent asked for, not a Hive cleanup archive', async () => {
    const result = await runScenario(database('worker'), { acceptedWorker: true })

    expect(result.observed.toolResults).toEqual([deferredOutcome(result.runId, 'worker')])
    expect(result.archivedAfterRun).toBe(true)
    expect(result.journal).toEqual([
      { caller_id: `session-agent:worker:${result.runId}`, operation: 'archive' },
    ])
  }, 45_000)

  it('lets Hive cleanup archive the Worker when its own archive is skipped', async () => {
    const result = await runScenario(database('worker-failed'), {
      acceptedWorker: true,
      terminalStatus: 'failed',
    })

    expect(result.observed.toolResults).toEqual([deferredOutcome(result.runId, 'worker')])
    expect(result.archivedAfterRun).toBe(true)
    expect(result.journal).toEqual([{ caller_id: QUEEN_CALLER_ID, operation: 'archive' }])
  }, 45_000)

  it('keeps a Queen whose Worker is still working, so its report has a reader', async () => {
    const result = await runScenario(database('working-worker'), { workerStillWorking: true })

    expect(result.observed.toolResults).toEqual([deferredOutcome(result.runId)])
    expect(result.archivedAfterRun).toBe(false)
    expect(result.journal).toEqual([])
  }, 45_000)

  it('archives once when the agent asks twice', async () => {
    const result = await runScenario(database('twice'), { archiveCalls: 2 })

    expect(result.observed.toolResults).toEqual([
      deferredOutcome(result.runId),
      deferredOutcome(result.runId),
    ])
    expect(result.archivedAfterRun).toBe(true)
    expect(result.journal).toHaveLength(1)
  }, 45_000)

  it('leaves the Session and its next Run alone when a Follow-up is queued meanwhile', async () => {
    const result = await runScenario(database('follow-up'), {
      afterArchive: (runtime) =>
        Runtime.runPromise(runtime)(
          controlCommandAs('gui:local-user', 'user-follow-up', {
            operation: 'follow-up',
            sessionId: 'queen',
            input: { text: 'Look at the staging errors too.', attachmentIds: [] },
          }),
        ),
    })

    expect(result.observed.toolResults).toEqual([deferredOutcome(result.runId)])
    expect(result.archivedAfterRun).toBe(false)
    expect(result.runs).toEqual([
      { id: result.runId, status: 'completed' },
      { id: expect.any(String), status: 'completed' },
    ])
    expect(result.journal).toEqual([])
  }, 45_000)

  it('withdraws the archive when the Session is unarchived before its Run ends', async () => {
    const result = await runScenario(database('withdrawn'), {
      afterArchive: (runtime) =>
        Runtime.runPromise(runtime)(
          controlCommandAs('session-agent:queen:run-generated-1', 'keep-it', {
            operation: 'unarchive',
            sessionId: 'queen',
          }),
        ),
    })

    expect(result.observed.toolResults).toEqual([deferredOutcome(result.runId)])
    expect(result.archivedAfterRun).toBe(false)
    expect(result.journal).toEqual([
      { caller_id: 'session-agent:queen:run-generated-1', operation: 'unarchive' },
    ])
  }, 45_000)

  it.each([
    ['is stopped', 'interrupted'],
    ['fails', 'failed'],
  ] as const)(
    'does not archive when the Run that asked %s',
    async (_label, terminalStatus) => {
      const result = await runScenario(database(terminalStatus), { terminalStatus })

      expect(result.observed.toolResults).toEqual([deferredOutcome(result.runId)])
      expect(result.archivedAfterRun).toBe(false)
      expect(result.runs).toEqual([{ id: result.runId, status: terminalStatus }])
      expect(result.journal).toEqual([])
    },
    45_000,
  )
})
