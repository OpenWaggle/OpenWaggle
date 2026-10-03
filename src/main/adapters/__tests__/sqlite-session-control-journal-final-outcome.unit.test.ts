import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionControlOperationJournal } from '../../ports/session-control-operation-journal'
import { SqliteSessionControlOperationJournalLive } from '../sqlite-session-control-operation-journal'
import { makeSessionControlRunLifecycleTestLayer } from './sqlite-session-control-run-lifecycle-test-layer'

const request = {
  contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
  requestId: 'request-interrupt',
  idempotencyKey: 'idempotency-interrupt',
  command: { operation: 'interrupt', sessionId: 'session-target', expectedRunId: 'run-next' },
} as const

describe('SQLite Session Control journal outcomes derived from the final state', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-journal-final-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('records and replays the revision the finalized state reached', async () => {
    const layer = SqliteSessionControlOperationJournalLive.pipe(
      Layer.provideMerge(
        makeSessionControlRunLifecycleTestLayer(path.join(temporaryRoot, 'journal.sqlite')),
      ),
    )
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const journal = yield* SessionControlOperationJournal
        yield* journal.claim({
          callerId: 'local-user',
          request,
          decide: () => ({ accepted: true }),
        })
        // Another writer changes the Session before this operation completes.
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE session_control_states SET state_revision = ${41}`
        const complete = journal.complete({
          callerId: 'local-user',
          request,
          outcome: {
            operation: 'interrupt',
            effect: 'interruption-requested',
            sessionId: 'session-target',
            runId: 'run-next',
            stateRevision: 1,
          },
          finalizeState: (state) => ({ ...state, revision: state.revision + 1 }),
          outcomeForFinalState: (state) => ({
            operation: 'interrupt',
            effect: 'interruption-requested',
            sessionId: 'session-target',
            runId: 'run-next',
            stateRevision: state.revision,
          }),
        })
        return { recorded: yield* complete, replayed: yield* complete }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.recorded).toMatchObject({ stateRevision: 42 })
    expect(result.replayed).toEqual(result.recorded)
  })
})
