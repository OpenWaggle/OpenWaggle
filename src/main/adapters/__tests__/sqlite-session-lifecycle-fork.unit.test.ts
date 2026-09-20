import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import {
  forkLifecycleInput,
  makeSessionLifecycleTestLayer,
  rootLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

let temporaryRoot = ''

describe('SQLite Session lifecycle fork persistence', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-lifecycle-fork-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('atomically persists a fork snapshot, inherited Workspace, and derivation provenance', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'fork.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionLifecycleRepository
        const response = yield* repository.execute(forkLifecycleInput())
        const replay = yield* repository.execute(forkLifecycleInput())
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{
          readonly workspace_id: string
          readonly source_session_id: string
          readonly source_node_id: string
          readonly position: string
          readonly active_node_id: string | null
          readonly node_count: number
        }>`
          SELECT
            session_workspace_bindings.workspace_id,
            session_derivations.source_session_id,
            session_derivations.source_node_id,
            session_derivations.position,
            sessions.last_active_node_id AS active_node_id,
            (SELECT COUNT(*) FROM session_nodes WHERE session_id = sessions.id) AS node_count
          FROM sessions
          JOIN session_workspace_bindings ON session_workspace_bindings.session_id = sessions.id
          JOIN session_derivations ON session_derivations.derived_session_id = sessions.id
          WHERE sessions.id = ${'session-fork'}
        `
        return { response, replay, row: rows[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.replay).toEqual({ ...result.response, replayed: true })
    expect(result.response.outcome).toEqual({
      operation: 'fork',
      effect: 'forked-session',
      sessionId: 'session-fork',
      sourceSessionId: 'session-parent',
      sourceNodeId: 'source-node',
      position: 'at',
      workspaceId: 'workspace-parent',
    })
    expect(result.row).toEqual({
      workspace_id: 'workspace-parent',
      source_session_id: 'session-parent',
      source_node_id: 'source-node',
      position: 'at',
      active_node_id: 'fork-node',
      node_count: 1,
    })
  })

  it('rejects idempotency-key reuse with a different lifecycle command', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'idempotency.sqlite'))
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionLifecycleRepository
        const input = rootLifecycleInput('create')
        yield* repository.execute(input)
        return yield* repository
          .execute({
            ...input,
            request: {
              ...input.request,
              command: { ...input.request.command, title: 'Different root' },
            },
          })
          .pipe(Effect.flip)
      }).pipe(Effect.provide(layer)),
    )

    expect(error).toMatchObject({
      _tag: 'SessionLifecycleRepositoryError',
      operation: 'idempotency-key-reused',
    })
  })
})
