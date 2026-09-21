import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  compareNativeRanking,
  seedNativeRankingSessions,
  verifyNativeDiscoveryFacts,
} from './native-ranking.test-utils'
import { makeSessionQueryRuntime } from './sqlite-session-query-test-layer'

describe('Native discovery projection mutations', () => {
  let temporaryRoot = ''
  let runtime: ReturnType<typeof makeSessionQueryRuntime>

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-native-mutations-'))
    runtime = makeSessionQueryRuntime(path.join(temporaryRoot, 'search.sqlite'))
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`CREATE VIRTUAL TABLE native_ranking_reference_vocabulary
          USING fts5vocab(session_node_discovery_search, 'instance')`)
        yield* seedNativeRankingSessions(sql)
      }),
    )
  })

  afterEach(async () => {
    await runtime.dispose()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('retains exact native facts and scores across replacement, archive, empty rows and deletion', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* verifyNativeDiscoveryFacts(sql)
        yield* compareNativeRanking(sql)
        for (const content of [
          'markernative markernative Café résumé Kelvin 42 私用語 \uE000 नमस्ते',
          'markernative markernative Café résumé Kelvin 42 私用語 \uE000 नमस्ते',
          'markernative beta ß Ελληνικά 漢字 cafe\u0301',
          '',
        ]) {
          yield* sql`UPDATE session_nodes SET content_json = ${JSON.stringify({ text: content })}
            WHERE id = ${'native-0000-node'}`
          yield* verifyNativeDiscoveryFacts(sql)
          yield* compareNativeRanking(sql)
        }
        yield* sql`INSERT INTO session_nodes (
          id, session_id, kind, role, timestamp_ms, content_json, metadata_json, created_order
        ) VALUES (${'native-later'}, ${'native-0001'}, ${'message'}, ${'assistant'}, 2,
          ${'{"text":"markernative markernative extra"}'}, ${'{}'}, 1)`
        yield* verifyNativeDiscoveryFacts(sql)
        yield* compareNativeRanking(sql)
        yield* sql`UPDATE sessions SET archived = 1 WHERE id < ${'native-0800'}`
        yield* compareNativeRanking(sql)
        yield* compareNativeRanking(sql, { includeArchived: true })
        yield* sql`UPDATE sessions SET archived = 0 WHERE id = ${'native-0001'}`
        yield* compareNativeRanking(sql)
        yield* sql`INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at)
          VALUES (${'native-empty'}, ${'pi-native-empty'}, ${'Empty'}, 1, 1)`
        yield* verifyNativeDiscoveryFacts(sql)
        yield* compareNativeRanking(sql)
        yield* sql`DELETE FROM session_nodes WHERE id = ${'native-0001-node'}`
        yield* verifyNativeDiscoveryFacts(sql)
        yield* compareNativeRanking(sql)
        yield* sql`DELETE FROM sessions WHERE id IN (${'native-0001'}, ${'native-empty'})`
        yield* verifyNativeDiscoveryFacts(sql)
        yield* compareNativeRanking(sql)
        yield* sql`UPDATE session_nodes SET session_id = ${'native-0003'}, created_order = 2
          WHERE id = ${'native-0002-node'}`
        yield* verifyNativeDiscoveryFacts(sql)
        yield* compareNativeRanking(sql)
      }),
    )
  })

  it('rolls back source, native FTS, postings, signatures and staging after publication failure', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const before = yield* compareNativeRanking(sql)
        yield* sql.unsafe(`
          CREATE TRIGGER reject_native_signature AFTER INSERT ON session_discovery_term_signatures
          WHEN new.term = 'rollbackmarker' BEGIN
            SELECT RAISE(ABORT, 'Injected post-publication failure');
          END
        `)
        const failed = yield* Effect.exit(
          sql.withTransaction(sql`UPDATE session_nodes
            SET content_json = ${'{"text":"markernative rollbackmarker"}'}
            WHERE id = ${'native-0000-node'}`),
        )
        expect(Exit.isFailure(failed)).toBe(true)
        yield* verifyNativeDiscoveryFacts(sql)
        expect(yield* compareNativeRanking(sql)).toEqual(before)
        const source = yield* sql<{ readonly content_json: string }>`
          SELECT content_json FROM session_nodes WHERE id = ${'native-0000-node'}
        `
        expect(source).toEqual([{ content_json: '{"text":"markernative filler"}' }])
      }),
    )
  })
})
