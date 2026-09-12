import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { refreshSessionTranscriptTerms } from '../../services/session-transcript-term-projection'
import { makeSessionQueryRuntime } from './sqlite-session-query-test-layer'

describe('Session transcript term projection', () => {
  let root = ''
  let runtime: ReturnType<typeof makeSessionQueryRuntime> | undefined

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-transcript-terms-'))
    runtime = makeSessionQueryRuntime(path.join(root, 'terms.sqlite'))
  })

  afterEach(async () => {
    await runtime?.dispose()
    runtime = undefined
    await fs.rm(root, { recursive: true, force: true })
  })

  it('retains exact-term evidence without the obsolete transcript FTS table', async () => {
    if (!runtime) throw new Error('Runtime missing.')
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, parent_id, kind, role, timestamp_ms,
            content_json, metadata_json, branch_hint_id, created_order
          ) VALUES (
            ${'term-node'}, ${'worker'}, NULL, ${'message'}, ${'assistant'}, ${1000},
            ${'{"text":"terminal exact marker"}'}, ${'{}'}, NULL, ${1000}
          )
        `
        yield* refreshSessionTranscriptTerms(sql, ['worker'])
        const terms = yield* sql<{
          readonly occurrences: number
          readonly first_node_id: string
        }>`
          SELECT occurrences, first_node_id FROM session_transcript_terms
          WHERE session_id = ${'worker'} AND term = ${'terminal'}
        `
        const obsolete = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM sqlite_master
          WHERE type = ${'table'} AND name = ${'session_transcript_search'}
        `
        return { terms, obsolete }
      }),
    )

    expect(result.terms).toEqual([{ occurrences: 1, first_node_id: 'term-node' }])
    expect(result.obsolete).toEqual([{ count: 0 }])
  })
})
