import type * as SqlClient from '@effect/sql/SqlClient'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Schedule from 'effect/Schedule'
import { expect } from 'vitest'
import type { SessionControlRunExecutionInput } from '../../ports/session-control-run-executor'

/** Shared by the Delegation revision integration tests (#454). */
export const FEEDBACK = 'Cover the error path too.'

export const REVISED_SPECIFICATION = {
  objective: 'Review the tests, including the error path',
  deliverables: ['A list of missing error-path tests'],
  acceptanceCriteria: ['Every error path is named'],
  resourceReferences: [],
} as const

export function recordingExecutor(
  options: { readonly holdFirstRun?: Deferred.Deferred<void> } = {},
) {
  const runs: SessionControlRunExecutionInput[] = []
  return {
    runs,
    executor: {
      execute: (input: SessionControlRunExecutionInput) =>
        Effect.gen(function* () {
          runs.push(input)
          if (runs.length === 1 && options.holdFirstRun) yield* Deferred.await(options.holdFirstRun)
          return { terminalStatus: 'completed' as const, finalResponse: `Reply ${runs.length}.` }
        }),
    },
  }
}

export function waitFor(condition: () => boolean) {
  return Effect.suspend(() => (condition() ? Effect.void : Effect.fail('pending' as const))).pipe(
    Effect.retry(Schedule.spaced('10 millis').pipe(Schedule.upTo('5 seconds'))),
  )
}

export function workerDelegation(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const contract = yield* sql<{ readonly state: string }>`
      SELECT state FROM delegation_contracts WHERE id = ${'delegation-worker'}
    `
    const submissions = yield* sql<{ readonly revision: number; readonly source_run_id: string }>`
      SELECT revision, source_run_id FROM delegation_submissions
      WHERE delegation_id = ${'delegation-worker'} ORDER BY revision
    `
    return { state: contract[0]?.state, submissions }
  })
}

/** The Worker's queued and active work: what a `nextActor: worker` must stand on. */
export function workerWork(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const control = yield* sql<{ readonly active_run_id: string | null }>`
      SELECT active_run_id FROM session_control_states WHERE session_id = ${'worker'}
    `
    const followUps = yield* sql<{ readonly intent_json: string }>`
      SELECT intent_json FROM session_follow_ups WHERE session_id = ${'worker'} ORDER BY position
    `
    return {
      activeRunId: control[0]?.active_run_id ?? null,
      queuedTexts: followUps.map((row) => {
        const intent: unknown = JSON.parse(row.intent_json)
        return typeof intent === 'object' && intent !== null && 'text' in intent
          ? String(intent.text)
          : ''
      }),
    }
  })
}

export function expectRevisionPrompt(
  text: string | undefined,
  expected: { readonly submissionRevision: number; readonly feedback: string },
) {
  expect(text).toContain('OpenWaggle Host-authored Delegation revision request')
  expect(text).toContain('"delegationId":"delegation-worker"')
  expect(text).toContain(`"submissionRevision":${String(expected.submissionRevision)}`)
  expect(text).toContain(JSON.stringify(expected.feedback))
}
