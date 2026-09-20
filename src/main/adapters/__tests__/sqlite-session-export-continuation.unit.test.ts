import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mcpExportQuery } from './sqlite-session-export-query-test-support'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

describe('SQLite Session export continuation', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-export-continuation-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it.each(['update', 'delete', 'historical-insert'] as const)(
    'rejects continuation after a snapshot node %s instead of mixing node versions',
    async (mutation) => {
      const runtime = makeRuntime(path.join(temporaryRoot, `export-${mutation}.sqlite`))
      runtimes.push(runtime)
      const first = await executeQuery(
        runtime,
        mcpExportQuery({
          operation: 'export',
          sessionId: 'worker',
          limit: 1,
          branchScope: 'active-branch',
        }),
      )
      if (first.outcome.operation !== 'export' || !('manifest' in first.outcome)) {
        throw new Error('Expected export outcome.')
      }

      await runtime.runPromise(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient
          if (mutation === 'update') {
            yield* sql`
              UPDATE session_nodes SET content_json = ${'{"text":"mutated"}'}
              WHERE id = ${'node-worker-2'}
            `
            return
          }
          if (mutation === 'delete') {
            yield* sql`DELETE FROM session_nodes WHERE id = ${'node-worker-2'}`
            return
          }
          yield* sql`
            INSERT INTO session_nodes (
              id, session_id, parent_id, kind, role, timestamp_ms,
              content_json, metadata_json, branch_hint_id, created_order
            ) VALUES (
              ${'node-worker-backfilled'}, ${'worker'}, ${'node-worker-1'}, ${'message'},
              ${'assistant'}, ${3}, ${'{"text":"backfilled"}'}, ${'{}'},
              ${'worker:branch:main'}, ${1}
            )
          `
        }),
      )

      const second = await executeQuery(
        runtime,
        mcpExportQuery({
          operation: 'export',
          sessionId: 'worker',
          limit: 1,
          afterCreatedOrder: first.outcome.nextCreatedOrder,
          snapshotManifest: first.outcome.manifest,
        }),
      )

      expect(second.outcome).toMatchObject({
        operation: 'export',
        error: { code: 'resync_required' },
      })
    },
  )

  it('rejects a continuation cursor without its first-page manifest at the repository boundary', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'missing-manifest.sqlite'))
    runtimes.push(runtime)

    const response = await executeQuery(runtime, {
      operation: 'export',
      sessionId: 'worker',
      limit: 1,
      afterCreatedOrder: 0,
    })

    expect(response.outcome).toMatchObject({
      operation: 'export',
      error: { code: 'resync_required' },
    })
  })
})
