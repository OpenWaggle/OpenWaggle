import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import Database from 'better-sqlite3'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionResourceRepository } from '../../ports/session-resource-repository'
import { SESSION_RESOURCE_OCCURRENCE_PREVIEW_LIMIT } from '../sqlite-session-resource-catalog-shared'
import { makeSessionResourceCatalogTestLayer } from './sqlite-session-resource-pagination.test-harness'

let tmpRoot = ''
const executedSql: string[] = []
type StatementMethod = (this: { readonly source: string }, ...args: unknown[]) => unknown

function recordStatements() {
  const probe = new Database(':memory:')
  const prototype: Record<'all' | 'run' | 'get', StatementMethod> = Object.getPrototypeOf(
    probe.prepare('SELECT 1'),
  )
  probe.close()
  const originals = { all: prototype.all, run: prototype.run, get: prototype.get }
  for (const method of ['all', 'run', 'get'] as const) {
    const original = originals[method]
    prototype[method] = function (this: { readonly source: string }, ...args: unknown[]) {
      executedSql.push(this.source)
      return original.apply(this, args)
    }
  }
  return () => Object.assign(prototype, originals)
}

describe('session resource occurrence previews', () => {
  let restore: () => void = () => undefined

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-resource-preview-'))
    executedSql.length = 0
    restore = recordStatements()
  })

  afterEach(async () => {
    restore()
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('reads a resource within the preview limit without walking the active path', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const repository = yield* SessionResourceRepository
        yield* sql`
          INSERT INTO session_resources (
            id, session_id, canonical_key, kind, title, mime_type, locator, managed_path,
            available, is_source, is_output, created_at, updated_at
          ) VALUES (
            'few', 'session-1', 'url:https://few.test', 'link', 'Few', NULL,
            'https://few.test', NULL, 1, 1, 0, 1, 1
          )
        `
        for (const index of [2, 0, 1]) {
          yield* sql`
            INSERT INTO session_resource_occurrences (
              id, resource_id, node_id, branch_id, actor, activity, label, locator,
              display_name, display_order, created_at
            ) VALUES (
              ${`few-${String(index)}`}, 'few', NULL, NULL, 'user', 'provided', NULL,
              'https://few.test', NULL, NULL, ${10 + index}
            )
          `
        }
        executedSql.length = 0
        const few = yield* repository.findById(SessionId('session-1'), 'few', 'all')
        const fewQueries = [...executedSql]
        executedSql.length = 0
        const many = yield* repository.findById(SessionId('session-1'), 'resource-1', 'all')
        return { few, fewQueries, many, manyQueries: [...executedSql] }
      }).pipe(
        Effect.provide(makeSessionResourceCatalogTestLayer(path.join(tmpRoot, 'preview.sqlite'))),
      ),
    )

    expect(result.few?.occurrences.map(({ id }) => id)).toEqual(['few-0', 'few-1', 'few-2'])
    expect(result.fewQueries.some((source) => source.includes('active_path'))).toBe(false)
    // Over the limit, the active path still decides which occurrences the preview keeps.
    expect(result.many?.occurrences).toHaveLength(SESSION_RESOURCE_OCCURRENCE_PREVIEW_LIMIT)
    expect(result.manyQueries.some((source) => source.includes('active_path'))).toBe(true)
  })
})
