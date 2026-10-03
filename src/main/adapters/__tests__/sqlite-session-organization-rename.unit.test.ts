import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { organizeSession } from '../../application/session-organization-service'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'

describe('SQLite Session rename', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-rename-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('makes a rename manual, settles an owed refinement, and leaves recency alone', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'rename.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE sessions SET title_source = ${'generated'}, title_needs_refinement = ${1}
          WHERE id = ${'session-target'}`
        const before = yield* sql<{ readonly updated_at: number }>`
          SELECT updated_at FROM sessions WHERE id = ${'session-target'}`
        yield* organizeSession({
          callerId: 'local-user',
          request: {
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'manual-rename',
            idempotencyKey: 'manual-rename-key',
            command: { operation: 'rename', sessionId: 'session-target', title: 'My name' },
          },
        })
        const after = yield* sql<{
          readonly title_source: string
          readonly title_needs_refinement: number
          readonly updated_at: number
        }>`SELECT title_source, title_needs_refinement, updated_at FROM sessions
          WHERE id = ${'session-target'}`
        return { before: before[0], after: after[0] }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.after).toEqual({
      title_source: 'manual',
      title_needs_refinement: 0,
      updated_at: result.before?.updated_at,
    })
  })
})
