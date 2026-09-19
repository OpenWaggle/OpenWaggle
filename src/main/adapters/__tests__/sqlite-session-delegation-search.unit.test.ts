import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it } from 'vitest'
import { executeSessionQuery, makeSessionQueryRuntime } from './sqlite-session-query-test-layer'

describe('SQLite Session delegation search', () => {
  const runtimes: Array<ReturnType<typeof makeSessionQueryRuntime>> = []
  const temporaryRoots: string[] = []

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await Promise.all(
      temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
    )
  })

  it('replaces an amended objective instead of retaining stale lexical matches', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-delegation-search-'))
    temporaryRoots.push(root)
    const runtime = makeSessionQueryRuntime(path.join(root, 'session-host.sqlite'))
    runtimes.push(runtime)

    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO delegation_specifications (
            delegation_id, revision, specification_json, authored_by, created_at
          ) VALUES (
            ${'delegation-worker'}, ${2},
            ${'{"objective":"Audit protocol durability","deliverables":[],"acceptanceCriteria":[],"resourceReferences":[]}'},
            ${'queen'}, ${2}
          )
        `
        yield* sql`
          UPDATE delegation_contracts SET current_specification_revision = ${2}, updated_at = ${2}
          WHERE id = ${'delegation-worker'}
        `
      }),
    )

    const stale = await executeSessionQuery(runtime, {
      operation: 'search',
      query: 'migration',
      mode: 'lexical',
      limit: 10,
    })
    const current = await executeSessionQuery(runtime, {
      operation: 'search',
      query: 'durability',
      mode: 'lexical',
      limit: 10,
    })

    expect(stale.outcome).toMatchObject({ operation: 'search', sessions: [] })
    expect(current.outcome).toMatchObject({
      operation: 'search',
      sessions: [{ sessionId: 'worker' }],
    })
  })
})
