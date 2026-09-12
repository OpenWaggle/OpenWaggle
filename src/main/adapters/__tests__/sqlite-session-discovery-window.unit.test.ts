import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionDiscoveryWindowStore } from '../session-discovery-window-store'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

describe('SQLite Session discovery windows', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-discovery-window-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('preserves ranking while the corpus changes and rejects cursor transfer', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'search-window.sqlite'))
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        for (const [id, title, updatedAt] of [
          ['match-a', 'Protocol alpha', 10],
          ['match-b', 'Protocol beta', 11],
        ] as const) {
          yield* sql`
            INSERT INTO sessions (
              id, pi_session_id, project_path, title, created_at, updated_at
            ) VALUES (${id}, ${`pi-${id}`}, ${'/project-a'}, ${title}, ${1}, ${updatedAt})
          `
        }
      }),
    )
    const query = { operation: 'search', query: 'Protocol', mode: 'lexical' } as const
    const baseline = await executeQuery(runtime, { ...query, limit: 10 }, undefined, 'caller-a')
    const first = await executeQuery(runtime, { ...query, limit: 1 }, undefined, 'caller-a')
    if (
      baseline.outcome.operation !== 'search' ||
      !('sessions' in baseline.outcome) ||
      first.outcome.operation !== 'search' ||
      !('sessions' in first.outcome) ||
      !first.outcome.nextCursor
    ) {
      throw new Error('Expected a paginated discovery window.')
    }
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`UPDATE sessions SET title = ${'Renamed away'} WHERE id = ${'match-a'}`
        yield* sql`
          INSERT INTO sessions (
            id, pi_session_id, project_path, title, created_at, updated_at
          ) VALUES (
            ${'match-new'}, ${'pi-match-new'}, ${'/project-a'}, ${'Protocol'}, ${1}, ${20}
          )
        `
      }),
    )
    const pageQuery = { ...query, limit: 10, cursor: first.outcome.nextCursor }
    const transferred = await executeQuery(runtime, pageQuery, undefined, 'caller-b')
    const remainder = await executeQuery(runtime, pageQuery, undefined, 'caller-a')
    if (remainder.outcome.operation !== 'search' || !('sessions' in remainder.outcome)) {
      throw new Error('Expected the remaining discovery window.')
    }

    expect(transferred.outcome).toMatchObject({
      operation: 'search',
      error: { code: 'cursor_mismatch' },
    })
    expect(
      [...first.outcome.sessions, ...remainder.outcome.sessions].map((item) => item.sessionId),
    ).toEqual(baseline.outcome.sessions.map((item) => item.sessionId))
    expect(remainder.outcome.sessions.map((item) => item.sessionId)).not.toContain('match-new')
  })

  it('limits one caller without evicting another caller window', () => {
    const store = new SessionDiscoveryWindowStore()
    const create = (callerKey: string, now: number) =>
      store.create({
        callerKey,
        signature: 'query',
        authoritySignature: 'authority',
        entries: [],
        truncated: false,
        modeOutcome: { searchBackend: 'lexical', requestedSearchMode: 'lexical' },
        now,
      })
    const protectedWindow = create('caller-b', 0)
    const firstNoisyWindow = create('caller-a', 1)
    for (let index = 2; index <= 17; index += 1) create('caller-a', index)

    expect(
      store.read({
        id: protectedWindow.id,
        callerKey: 'caller-b',
        signature: 'query',
        authoritySignature: 'authority',
        now: 18,
      }).status,
    ).toBe('available')
    expect(
      store.read({
        id: firstNoisyWindow.id,
        callerKey: 'caller-a',
        signature: 'query',
        authoritySignature: 'authority',
        now: 18,
      }).status,
    ).toBe('expired')
  })

  it('uses tokenized AND search unless the complete query is explicitly quoted', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'lexical-terms.sqlite'))
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO sessions (
            id, pi_session_id, project_path, title, created_at, updated_at
          ) VALUES
            (${'terms-separated'}, ${'pi-terms-separated'}, ${'/project-a'},
              ${'alpha distant beta'}, ${1}, ${1}),
            (${'terms-phrase'}, ${'pi-terms-phrase'}, ${'/project-a'},
              ${'alpha beta together'}, ${1}, ${1})
        `
      }),
    )

    const terms = await executeQuery(runtime, {
      operation: 'search',
      query: 'alpha beta',
      mode: 'lexical',
      limit: 10,
    })
    const phrase = await executeQuery(runtime, {
      operation: 'search',
      query: '"alpha beta"',
      mode: 'lexical',
      limit: 10,
    })
    if (
      terms.outcome.operation !== 'search' ||
      !('sessions' in terms.outcome) ||
      phrase.outcome.operation !== 'search' ||
      !('sessions' in phrase.outcome)
    ) {
      throw new Error('Expected lexical search results.')
    }

    expect(terms.outcome.sessions.map((session) => session.sessionId)).toEqual(
      expect.arrayContaining(['terms-separated', 'terms-phrase']),
    )
    expect(phrase.outcome.sessions.map((session) => session.sessionId)).toEqual(['terms-phrase'])
  })
})
