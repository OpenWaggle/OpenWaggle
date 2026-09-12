import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId, WorkspaceId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionLifecyclePreparationService } from '../../ports/session-lifecycle-preparation-service'
import { makeLifecyclePreparationLayer } from './session-lifecycle-preparation-test-support'

describe('Session lifecycle preparation recovery', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-lifecycle-recovery-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('removes an abandoned Pi file and preparation journal during Host recovery', async () => {
    const abandonedFile = path.join(temporaryRoot, 'abandoned.jsonl')
    await fs.writeFile(abandonedFile, 'orphaned Pi Session')
    const layer = makeLifecyclePreparationLayer(path.join(temporaryRoot, 'recovery.sqlite'), [])

    const remaining = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_lifecycle_preparation_attempts (
            attempt_id, session_id, pi_session_file, created_at, updated_at
          ) VALUES (${'attempt-abandoned'}, ${'session-abandoned'}, ${abandonedFile}, ${1}, ${1})
        `
        const service = yield* SessionLifecyclePreparationService
        yield* service.recoverPending
        return yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_lifecycle_preparation_attempts
        `
      }).pipe(Effect.provide(layer)),
    )

    expect(remaining).toEqual([{ count: 0 }])
    await expect(fs.stat(abandonedFile)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves a committed Session Pi file when attempt cleanup was interrupted', async () => {
    const committedFile = path.join(temporaryRoot, 'committed.jsonl')
    await fs.writeFile(committedFile, 'committed Pi Session')
    const layer = makeLifecyclePreparationLayer(path.join(temporaryRoot, 'committed.sqlite'), [])

    const remaining = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO sessions (id, project_path, pi_session_file)
          VALUES (${'session-committed'}, ${'/project'}, ${committedFile})
        `
        yield* sql`
          INSERT INTO session_lifecycle_preparation_attempts (
            attempt_id, session_id, pi_session_file, created_at, updated_at
          ) VALUES (
            ${'attempt-committed'}, ${'session-committed'}, ${committedFile}, ${1}, ${1}
          )
        `
        const service = yield* SessionLifecyclePreparationService
        yield* service.recoverPending
        return yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_lifecycle_preparation_attempts
        `
      }).pipe(Effect.provide(layer)),
    )

    expect(remaining).toEqual([{ count: 0 }])
    await expect(fs.readFile(committedFile, 'utf8')).resolves.toBe('committed Pi Session')
  })

  it('removes its journal immediately when preparation fails before returning an attempt', async () => {
    const projectPath = path.join(temporaryRoot, 'project')
    await fs.mkdir(projectPath)
    const layer = makeLifecyclePreparationLayer(
      path.join(temporaryRoot, 'failed.sqlite'),
      [],
      projectPath,
    )
    const remaining = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SessionLifecyclePreparationService
        yield* service
          .prepare({
            callerId: 'local-user',
            identities: {
              sessionId: SessionId('session-failed'),
              workspaceId: WorkspaceId('workspace-failed'),
            },
            request: {
              contractVersion: 2,
              requestId: 'request-failed',
              idempotencyKey: 'failed-once',
              command: {
                operation: 'launch',
                projectPath,
                objective: 'Use a missing definition.',
                attachmentIds: [],
                specialization: { agentDefinitionName: 'missing-agent' },
              },
            },
          })
          .pipe(Effect.flip)
        const sql = yield* SqlClient.SqlClient
        return yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_lifecycle_preparation_attempts
        `
      }).pipe(Effect.provide(layer)),
    )

    expect(remaining).toEqual([{ count: 0 }])
  })
})
