import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionDelegationRepository } from '../../ports/session-delegation-repository'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import { observeDelegationTurnWrites } from '../sqlite-session-delegation-write-observer'
import {
  makeSessionLifecycleTestLayer,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

describe('SQLite Delegation write observer', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-write-observer-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('records only isolated-turn paths outside the latest declared write scope', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(root, 'observer.db'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* SessionLifecycleRepository
        const delegations = yield* SessionDelegationRepository
        const sql = yield* SqlClient.SqlClient
        yield* lifecycle.execute(spawnLifecycleInput())
        yield* delegations.execute({
          callerId: 'worker',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-claim',
            idempotencyKey: 'idempotency-claim',
            command: {
              operation: 'delegation-claim',
              sessionId: 'session-worker',
              delegationId: 'delegation-worker',
              claims: [
                { access: 'write', target: { type: 'workspace-tree', path: 'src/main' } },
                { access: 'write', target: { type: 'workspace-file', path: 'README.md' } },
              ],
              reason: 'Implementing the main-process adapter.',
            },
          },
          now: 3000,
        })
        const observations = yield* observeDelegationTurnWrites(sql, {
          workerSessionId: 'session-worker',
          runId: 'run-worker',
          paths: [
            'src/main/adapter.ts',
            'README.md',
            'src/shared/schema.ts',
            './src/shared/schema.ts',
          ],
          now: 4000,
        })
        const replay = yield* observeDelegationTurnWrites(sql, {
          workerSessionId: 'session-worker',
          runId: 'run-worker',
          paths: ['src/shared/schema.ts'],
          now: 5000,
        })
        const rows = yield* sql<{
          readonly path: string
          readonly claim_revision: number | null
          readonly provenance: string
        }>`
          SELECT path, claim_revision, provenance FROM delegation_undeclared_writes
          ORDER BY path
        `
        return { observations, replay, rows }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.observations).toMatchObject([
      {
        delegationId: 'delegation-worker',
        workerSessionId: 'session-worker',
        runId: 'run-worker',
        path: 'src/shared/schema.ts',
        claimRevision: 1,
        provenance: 'isolated-turn-checkpoint',
      },
    ])
    expect(result.replay).toHaveLength(0)
    expect(result.rows).toEqual([
      {
        path: 'src/shared/schema.ts',
        claim_revision: 1,
        provenance: 'isolated-turn-checkpoint',
      },
    ])
  })
})
