import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SESSION_QUERY_MAX_RESPONSE_BYTES } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  executeSessionQuery as executeQuery,
  makeSessionQueryRuntime as makeRuntime,
} from './sqlite-session-query-test-layer'

function expectDelegationPage(page: Awaited<ReturnType<typeof executeQuery>>) {
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(
    SESSION_QUERY_MAX_RESPONSE_BYTES,
  )
  if (page.outcome.operation !== 'delegations-read' || !('submissions' in page.outcome)) {
    throw new Error('Expected Delegation history page.')
  }
  return page.outcome
}

describe('SQLite Delegation query pagination', () => {
  let temporaryRoot = ''
  const runtimes: Array<ReturnType<typeof makeRuntime>> = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-delegation-query-'))
  })

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('byte-pages more than 64 MiB of Delegation history with stable cursors', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'large-delegation.sqlite'))
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`
          WITH RECURSIVE revisions(value) AS (
            SELECT 2 UNION ALL SELECT value + 1 FROM revisions WHERE value < 19
          )
          INSERT INTO delegation_submissions (
            delegation_id, revision, specification_revision, summary,
            submitted_by, provenance, created_at
          )
          SELECT 'delegation-worker', value, 1, 'Large evidence submission',
            'worker', 'agent-submitted', value + 10
          FROM revisions
        `)
        yield* sql.unsafe(`
          WITH RECURSIVE revisions(value) AS (
            SELECT 2 UNION ALL SELECT value + 1 FROM revisions WHERE value < 19
          ), ordinals(value) AS (
            SELECT 0 UNION ALL SELECT value + 1 FROM ordinals WHERE value < 255
          )
          INSERT INTO delegation_evidence (
            delegation_id, submission_revision, ordinal, kind, summary, created_at
          )
          SELECT 'delegation-worker', revisions.value, ordinals.value,
            'observed-command', replace(hex(zeroblob(16384)), '00', 'x'),
            revisions.value + 10
          FROM revisions CROSS JOIN ordinals
        `)
      }),
    )

    const revisions = new Set<number>()
    let cursor: string | undefined
    do {
      const outcome = expectDelegationPage(
        await executeQuery(runtime, {
          operation: 'delegations-read',
          delegationId: 'delegation-worker',
          limit: 200,
          ...(cursor ? { cursor } : {}),
        }),
      )
      for (const submission of outcome.submissions) revisions.add(submission.revision)
      cursor = outcome.nextCursor
    } while (cursor)

    expect(revisions.size).toBe(19)
  })

  it('accounts for JSON escaping when byte-paging Delegation history', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'escaped-delegation.sqlite'))
    runtimes.push(runtime)
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe(`
          WITH RECURSIVE revisions(value) AS (
            SELECT 2 UNION ALL SELECT value + 1 FROM revisions WHERE value < 15
          )
          INSERT INTO delegation_submissions (
            delegation_id, revision, specification_revision, summary,
            submitted_by, provenance, created_at
          )
          SELECT 'delegation-worker', value, 1,
            replace(hex(zeroblob(2097152)), '00', char(10)),
            'worker', 'agent-submitted', value + 20
          FROM revisions
        `)
      }),
    )

    const revisions = new Set<number>()
    let pageCount = 0
    let cursor: string | undefined
    do {
      const outcome = expectDelegationPage(
        await executeQuery(runtime, {
          operation: 'delegations-read',
          delegationId: 'delegation-worker',
          limit: 200,
          ...(cursor ? { cursor } : {}),
        }),
      )
      pageCount += 1
      for (const submission of outcome.submissions) revisions.add(submission.revision)
      cursor = outcome.nextCursor
    } while (cursor)

    expect(pageCount).toBeGreaterThan(1)
    expect(revisions.size).toBe(15)
  })

  it('keeps a rowid high-water snapshot when same-millisecond history is appended', async () => {
    const runtime = makeRuntime(path.join(temporaryRoot, 'delegation-snapshot.sqlite'))
    runtimes.push(runtime)
    const first = expectDelegationPage(
      await executeQuery(runtime, {
        operation: 'delegations-read',
        delegationId: 'delegation-worker',
        limit: 1,
      }),
    )
    expect(first.nextCursor).toBeDefined()
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO delegation_submissions (
            delegation_id, revision, specification_revision, summary,
            submitted_by, provenance, created_at
          ) VALUES (
            ${'delegation-worker'}, ${99}, ${1}, ${'Appended in the same millisecond'},
            ${'worker'}, ${'agent-submitted'}, ${1}
          )
        `
      }),
    )

    const revisions = new Set(first.submissions.map((submission) => submission.revision))
    let cursor = first.nextCursor
    while (cursor) {
      const outcome = expectDelegationPage(
        await executeQuery(runtime, {
          operation: 'delegations-read',
          delegationId: 'delegation-worker',
          limit: 1,
          cursor,
        }),
      )
      for (const submission of outcome.submissions) revisions.add(submission.revision)
      cursor = outcome.nextCursor
    }

    expect(revisions).not.toContain(99)
    const fresh = expectDelegationPage(
      await executeQuery(runtime, {
        operation: 'delegations-read',
        delegationId: 'delegation-worker',
        limit: 200,
      }),
    )
    expect(fresh.submissions.map((submission) => submission.revision)).toContain(99)
  })
})
