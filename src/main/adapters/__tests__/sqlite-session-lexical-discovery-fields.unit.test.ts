import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

describe('SQLite Session lexical discovery fields', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-discovery-fields-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('keeps multiword matches within one projected field and reports every matching field', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'field-boundary.sqlite'))
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO sessions (
            id, pi_session_id, project_path, title, archived, created_at, updated_at
          ) VALUES (
            ${'field-boundary'}, ${'pi-field-boundary'}, ${'/project-a'},
            ${'Field boundary'}, ${0}, ${1}, ${1}
          )
        `
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, kind, role, timestamp_ms, content_json,
            metadata_json, branch_hint_id, created_order
          ) VALUES (
            ${'field-boundary-initial'}, ${'field-boundary'}, ${'message'}, ${'user'}, ${1},
            ${'{"text":"boundaryalpha sharedmarker"}'}, ${'{}'},
            ${'field-boundary:main'}, ${0}
          )
        `
        yield* sql`
          INSERT INTO session_nodes (
            id, session_id, parent_id, kind, role, timestamp_ms, content_json,
            metadata_json, branch_hint_id, created_order
          ) VALUES (
            ${'field-boundary-preview'}, ${'field-boundary'},
            ${'field-boundary-initial'}, ${'message'}, ${'assistant'}, ${2},
            ${'{"text":"boundarybeta sharedmarker"}'}, ${'{}'},
            ${'field-boundary:main'}, ${1}
          )
        `
      }),
    )

    const split = await executeQuery(runtime, {
      operation: 'search',
      query: 'boundaryalpha boundarybeta',
      mode: 'lexical',
      limit: 10,
    })
    expect(split.outcome).toMatchObject({ operation: 'search', sessions: [] })

    const shared = await executeQuery(runtime, {
      operation: 'search',
      query: 'sharedmarker',
      mode: 'lexical',
      limit: 10,
    })
    expect(shared.outcome).toMatchObject({
      operation: 'search',
      sessions: [
        {
          sessionId: 'field-boundary',
          discoveryEvidence: {
            matchedFields: ['initial-objective', 'current-preview'],
          },
        },
      ],
    })
  })
})
