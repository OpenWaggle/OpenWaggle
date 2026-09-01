import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { refreshSessionTranscriptTerms } from '../../services/session-transcript-term-projection'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

describe('SQLite Session transcript search', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-transcript-search-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('deduplicates phrase matches by Session before applying the discovery window', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'phrase-dedup.sqlite'))
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE session_nodes SET content_json = ${'{"text":"shared monopoly marker"}'}
          WHERE id = ${'node-worker-1'}
        `
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, kind, role, timestamp_ms, content_json,
            metadata_json, branch_hint_id, created_order
          ) VALUES (
            ${'node-queen-1'}, ${'queen'}, ${'message'}, ${'assistant'}, ${1},
            ${'{"text":"shared monopoly marker"}'}, ${'{}'}, ${'queen:main'}, ${0}
          )
        `
        yield* refreshSessionTranscriptTerms(sql, ['queen', 'worker'])
      }),
    )

    const result = await executeQuery(runtime, {
      operation: 'search',
      query: '"shared monopoly marker"',
      searchScope: 'full-transcript',
      limit: 10,
    })
    expect(result.outcome).toMatchObject({ operation: 'search' })
    if (result.outcome.operation !== 'search' || !('sessions' in result.outcome)) return
    expect(result.outcome.sessions.map((session) => session.sessionId)).toEqual(
      expect.arrayContaining(['queen', 'worker']),
    )
  })

  it('ranks a relevant Session before truncating a common-term discovery window', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'rank-before-limit.sqlite'))
    runtimes.push(runtime)
    const sessionIds = Array.from(
      { length: 600 },
      (_, index) => `rank-${String(index).padStart(3, '0')}`,
    )
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`
          WITH RECURSIVE sequence(value) AS (
            SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value < 599
          )
          INSERT INTO sessions (
            id, pi_session_id, project_path, title, archived, created_at, updated_at
          )
          SELECT printf('rank-%03d', value), printf('pi-rank-%03d', value),
            '/project-a', printf('Rank %03d', value), 0, value, value FROM sequence
        `)
        yield* sql.unsafe(`
          WITH RECURSIVE sequence(value) AS (
            SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value < 599
          )
          INSERT INTO session_nodes (
            id, session_id, kind, role, timestamp_ms, content_json,
            metadata_json, branch_hint_id, created_order
          )
          SELECT printf('rank-node-%03d', value), printf('rank-%03d', value),
            'message', 'assistant', value,
            json_object('text', CASE WHEN value = 599
              THEN 'commonterm filler' ELSE 'commonterm filler ballast' END),
            '{}', printf('rank-%03d:main', value), 0 FROM sequence
        `)
        yield* refreshSessionTranscriptTerms(sql, sessionIds)
      }),
    )

    const result = await executeQuery(runtime, {
      operation: 'search',
      query: 'commonterm',
      searchScope: 'full-transcript',
      limit: 10,
    })
    expect(result.outcome.operation).toBe('search')
    if (result.outcome.operation !== 'search' || !('sessions' in result.outcome)) return
    expect(result.outcome.sessions[0]?.sessionId).toBe('rank-599')

    const phrase = await executeQuery(runtime, {
      operation: 'search',
      query: '"commonterm filler"',
      searchScope: 'full-transcript',
      limit: 10,
    })
    expect(phrase.outcome.operation).toBe('search')
    if (phrase.outcome.operation !== 'search' || !('sessions' in phrase.outcome)) return
    expect(phrase.outcome.sessions[0]?.sessionId).toBe('rank-599')
  })

  it('keeps quoted transcript phrases within one attributable node', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'phrase-node-boundary.sqlite'))
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO sessions (
            id, pi_session_id, project_path, title, archived, created_at, updated_at
          ) VALUES (
            ${'phrase-boundary'}, ${'pi-phrase-boundary'}, ${'/project-a'},
            ${'Phrase boundary'}, ${0}, ${1}, ${1}
          )
        `
        yield* sql.unsafe(`
          WITH RECURSIVE sequence(value) AS (
            SELECT 0 UNION ALL SELECT value + 1 FROM sequence WHERE value < 64
          )
          INSERT INTO session_nodes (
            id, session_id, kind, role, timestamp_ms, content_json,
            metadata_json, branch_hint_id, created_order
          )
          SELECT printf('phrase-node-%02d', value), 'phrase-boundary',
            'message', 'assistant', value,
            json_object('text', CASE value
              WHEN 63 THEN 'boundaryalpha'
              WHEN 64 THEN 'boundarybeta'
              ELSE 'filler' END),
            '{}', 'phrase-boundary:main', value FROM sequence
        `)
        yield* refreshSessionTranscriptTerms(sql, ['phrase-boundary'])
      }),
    )

    const split = await executeQuery(runtime, {
      operation: 'search',
      query: '"boundaryalpha boundarybeta"',
      searchScope: 'full-transcript',
      limit: 10,
    })
    expect(split.outcome).toMatchObject({ operation: 'search', sessions: [] })
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE session_nodes SET content_json = ${'{"text":"boundaryalpha boundarybeta"}'}
          WHERE id = ${'phrase-node-64'}
        `
        yield* refreshSessionTranscriptTerms(sql, ['phrase-boundary'])
      }),
    )
    const withinNode = await executeQuery(runtime, {
      operation: 'search',
      query: '"boundaryalpha boundarybeta"',
      searchScope: 'full-transcript',
      limit: 10,
    })
    expect(withinNode.outcome).toMatchObject({
      operation: 'search',
      sessions: [
        {
          sessionId: 'phrase-boundary',
          discoveryEvidence: {
            transcriptMatch: { nodeId: 'phrase-node-64', createdOrder: 64 },
          },
        },
      ],
    })
  })
})
