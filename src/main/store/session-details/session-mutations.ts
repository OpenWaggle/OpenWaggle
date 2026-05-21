import * as SqlClient from '@effect/sql/SqlClient'
import type { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { runStoreEffect } from '../store-runtime'
import { EMPTY_INDEX } from './constants'
import { stageSessionFileDeletion } from './file-deletion'
import type { UpdateSessionRuntimeInput } from './types'

export async function updateSessionRuntime(input: UpdateSessionRuntimeInput): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE sessions
        SET pi_session_id = COALESCE(${input.piSessionId ?? null}, pi_session_id),
            pi_session_file = COALESCE(${input.piSessionFile ?? null}, pi_session_file),
            updated_at = ${Date.now()}
        WHERE id = ${input.sessionId}
      `
    }),
  )
}

export async function deleteSession(id: SessionId): Promise<void> {
  const piSessionFile = await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const rows = yield* sql<{ readonly pi_session_file: string | null }>`
        SELECT pi_session_file FROM sessions WHERE id = ${id} LIMIT 1
      `
      return rows[EMPTY_INDEX]?.pi_session_file ?? null
    }),
  )
  const stagedFile = await stageSessionFileDeletion(piSessionFile)

  try {
    await runStoreEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`DELETE FROM sessions WHERE id = ${id}`
      }),
    )
    await stagedFile.cleanup()
  } catch (error) {
    await stagedFile.restore()
    throw error
  }
}

async function updateArchivedState(id: SessionId, archived: boolean) {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE sessions
        SET archived = ${archived ? 1 : 0}, updated_at = ${Date.now()}
        WHERE id = ${id}
      `
    }),
  )
}

export async function archiveSession(id: SessionId): Promise<void> {
  await updateArchivedState(id, true)
}

export async function unarchiveSession(id: SessionId): Promise<void> {
  await updateArchivedState(id, false)
}

export async function updateSessionTitle(id: SessionId, title: string): Promise<void> {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`
        UPDATE sessions
        SET title = ${title}, updated_at = ${Date.now()}
        WHERE id = ${id}
      `
    }),
  )
}
