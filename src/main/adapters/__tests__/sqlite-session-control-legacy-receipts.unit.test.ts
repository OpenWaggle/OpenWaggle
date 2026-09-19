import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { canonicalJson } from '@shared/canonical-json'
import {
  SESSION_CONTROL_CONTRACT_VERSION,
  type SessionControlMutationRequest,
} from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionControlOperationJournal } from '../../ports/session-control-operation-journal'
import { SessionControlRepository } from '../../ports/session-control-repository'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

describe('durable historical steering receipts', () => {
  let directory: string | undefined
  afterEach(async () => {
    if (directory) await fs.rm(directory, { recursive: true, force: true })
  })

  it.each(['steer', 'promote'] as const)(
    'replays historical %s without rewriting or repeating its side effect',
    async (operation) => {
      directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-legacy-receipt-'))
      const request: SessionControlMutationRequest = {
        contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
        requestId: 'replay',
        idempotencyKey: 'old-operation',
        command:
          operation === 'steer'
            ? {
                operation,
                sessionId: 'session-target',
                expectedRunId: 'historical-run',
                input: { text: '/transformed', attachmentIds: [] },
              }
            : {
                operation,
                sessionId: 'session-target',
                expectedRunId: 'historical-run',
                followUpId: 'historical-follow-up',
              },
      }
      const outcome = {
        sessionId: 'session-target',
        runId: 'historical-run',
        stateRevision: 7,
        ...(operation === 'steer'
          ? { operation, effect: 'steered-run' }
          : {
              operation,
              effect: 'promoted-follow-up',
              followUpId: 'historical-follow-up',
              queueRevision: 3,
            }),
      }
      const storedOutcome = JSON.stringify(outcome)
      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          yield* sql`
        INSERT INTO session_operations (
          caller_id, operation, target_scope, idempotency_key, request_json,
          status, outcome_json, created_at, updated_at
        ) VALUES (
          ${'caller'}, ${operation}, ${'session-target'}, ${request.idempotencyKey}, ${canonicalJson(request.command)},
          ${'completed'}, ${storedOutcome}, ${1}, ${2}
        )
      `
          const journal = yield* SessionControlOperationJournal
          const repository = yield* SessionControlRepository
          const input = {
            callerId: 'caller',
            request,
            decide: () => {
              throw new Error('A completed historical operation must never run again.')
            },
          }
          const journalReplay = yield* journal.claim(input)
          const repositoryReplay = yield* repository.executeMutation(input)
          const rows = yield* sql`SELECT outcome_json, updated_at FROM session_operations`
          return { journalReplay, repositoryReplay, rows }
        }).pipe(Effect.provide(makeSessionControlTestLayer(path.join(directory, 'state.sqlite')))),
      )

      const upgradedOutcome = { ...outcome, receipt: { delivery: 'unavailable' } }
      expect(results.journalReplay).toEqual({
        status: 'completed',
        replayed: true,
        outcome: upgradedOutcome,
      })
      expect(results.repositoryReplay).toEqual({ replayed: true, outcome: upgradedOutcome })
      expect(results.rows).toEqual([{ outcome_json: storedOutcome, updated_at: 2 }])
    },
  )
})
