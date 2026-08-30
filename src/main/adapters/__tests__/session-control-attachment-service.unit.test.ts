import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { SQLITE_PREPARE_CACHE_SIZE } from '../../services/database-constants'
import { SESSION_ATTACHMENT_TARGET_SCHEMA_STATEMENTS } from '../../services/session-host-attachment-schema'
import { sessionControlAttachmentServiceLayer } from '../session-control-attachment-service'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

function testLayer(
  databasePath: string,
  policy: Parameters<typeof sessionControlAttachmentServiceLayer>[0] = {},
) {
  const sqlite = SqliteClient.layer({
    filename: databasePath,
    prepareCacheSize: SQLITE_PREPARE_CACHE_SIZE,
  })
  const schema = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.unsafe('PRAGMA foreign_keys = ON')
      yield* sql.unsafe('CREATE TABLE sessions (id TEXT PRIMARY KEY)')
      yield* sql.unsafe(
        'CREATE TABLE session_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, status TEXT NOT NULL, intent_json TEXT)',
      )
      yield* sql.unsafe(
        'CREATE TABLE session_follow_ups (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, intent_json TEXT NOT NULL)',
      )
      for (const statement of SESSION_ATTACHMENT_TARGET_SCHEMA_STATEMENTS) {
        yield* sql.unsafe(statement)
      }
      yield* sql`INSERT INTO sessions (id) VALUES (${'session-a'}), (${'session-b'})`
    }).pipe(Effect.provide(sqlite)),
  )
  return Layer.mergeAll(
    sqlite,
    schema,
    sessionControlAttachmentServiceLayer(policy).pipe(Layer.provide(sqlite)),
  )
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-attachment-store-'))
  roots.push(root)
  const source = path.join(root, 'evidence.txt')
  await fs.writeFile(source, 'immutable evidence')
  return { root, source, databasePath: path.join(root, 'session-host.db') }
}

describe('Session Control prepared attachment storage', () => {
  it('binds a capability to one Session and deletes it with that Session', async () => {
    const input = await fixture()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SessionControlAttachmentService
        const [prepared] = yield* service.prepare({
          baseDirectory: input.root,
          entries: [{ path: input.source }],
          ownerCallerId: 'gui:local-user',
          requestId: 'prepare-a',
        })
        if (!prepared) return yield* Effect.die('Expected a prepared attachment.')
        const resolved = yield* service.resolve({
          attachmentIds: [prepared.id],
          sessionId: 'session-a',
          ownerCallerId: 'gui:local-user',
        })
        const replay = yield* Effect.either(
          service.resolve({
            attachmentIds: [prepared.id],
            sessionId: 'session-b',
            ownerCallerId: 'gui:local-user',
          }),
        )
        const wrongOwner = yield* Effect.either(
          service.resolve({
            attachmentIds: [prepared.id],
            sessionId: 'session-a',
            ownerCallerId: 'profile:other',
          }),
        )
        yield* service.release({
          attachmentIds: [prepared.id],
          sessionId: 'session-a',
          ownerCallerId: 'gui:local-user',
        })
        const [cascadeAttachment] = yield* service.prepare({
          baseDirectory: input.root,
          entries: [{ path: input.source }],
          ownerCallerId: 'gui:local-user',
          requestId: 'prepare-cascade',
        })
        if (!cascadeAttachment) return yield* Effect.die('Expected a cascade attachment.')
        yield* service.resolve({
          attachmentIds: [cascadeAttachment.id],
          sessionId: 'session-a',
          ownerCallerId: 'gui:local-user',
        })
        const sql = yield* SqlClient.SqlClient
        const rowsBeforeDelete = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_prepared_attachments
        `
        yield* sql`DELETE FROM sessions WHERE id = ${'session-a'}`
        const rows = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_prepared_attachments
        `
        return {
          resolved,
          replay,
          wrongOwner,
          countBeforeDelete: rowsBeforeDelete[0]?.count,
          countAfterDelete: rows[0]?.count,
        }
      }).pipe(Effect.provide(testLayer(input.databasePath))),
    )

    expect(result.resolved).toHaveLength(1)
    expect(result.replay._tag).toBe('Left')
    expect(result.wrongOwner._tag).toBe('Left')
    expect(result.countBeforeDelete).toBe(1)
    expect(result.countAfterDelete).toBe(0)
  })

  it('garbage-collects expired unbound rows and enforces a caller quota', async () => {
    const input = await fixture()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SessionControlAttachmentService
        const [expired] = yield* service.prepare({
          baseDirectory: input.root,
          entries: [{ path: input.source }],
          ownerCallerId: 'gui:local-user',
          requestId: 'expired',
        })
        if (!expired) return yield* Effect.die('Expected a prepared attachment.')
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE session_prepared_attachments SET expires_at = ${0} WHERE id = ${expired.id}
        `
        const replacement = yield* service.prepare({
          baseDirectory: input.root,
          entries: [{ path: input.source }],
          ownerCallerId: 'gui:local-user',
          requestId: 'replacement',
        })
        const quota = yield* Effect.either(
          service.prepare({
            baseDirectory: input.root,
            entries: [{ path: input.source }],
            ownerCallerId: 'gui:local-user',
            requestId: 'over-quota',
          }),
        )
        const rows = yield* sql<{ readonly id: string }>`
          SELECT id FROM session_prepared_attachments ORDER BY id
        `
        return { expiredId: expired.id, replacement, quota, rows }
      }).pipe(
        Effect.provide(
          testLayer(input.databasePath, {
            maxUnboundBytesPerOwner: Buffer.from('immutable evidence').toString('base64').length,
          }),
        ),
      ),
    )

    expect(result.rows).not.toContainEqual({ id: result.expiredId })
    expect(result.replacement).toHaveLength(1)
    expect(result.quota._tag).toBe('Left')
  })

  it('reuses a content-bound capability for an idempotent preparation retry', async () => {
    const input = await fixture()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SessionControlAttachmentService
        const request = {
          baseDirectory: input.root,
          entries: [{ path: input.source }],
          ownerCallerId: 'gui:local-user',
          requestId: 'stable-idempotency-key',
        } as const
        const first = yield* service.prepare(request)
        const replay = yield* service.prepare(request)
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_prepared_attachments
        `
        return { first, replay, count: rows[0]?.count }
      }).pipe(
        Effect.provide(
          testLayer(input.databasePath, {
            maxUnboundBytesPerOwner: Buffer.from('immutable evidence').toString('base64').length,
          }),
        ),
      ),
    )

    expect(result.replay.map((attachment) => attachment.id)).toEqual(
      result.first.map((attachment) => attachment.id),
    )
    expect(result.count).toBe(1)
  })

  it('retains only blobs referenced by live Runs or queued Follow-ups', async () => {
    const input = await fixture()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* SessionControlAttachmentService
        const prepared = yield* Effect.forEach(['run', 'queue', 'orphan'], (requestId) =>
          service
            .prepare({
              baseDirectory: input.root,
              entries: [{ path: input.source }],
              ownerCallerId: `profile:${requestId}`,
              requestId,
            })
            .pipe(Effect.map((attachments) => attachments[0])),
        )
        const [runAttachment, queueAttachment, orphanAttachment] = prepared
        if (!runAttachment || !queueAttachment || !orphanAttachment) {
          return yield* Effect.die('Expected three prepared attachments.')
        }
        yield* Effect.forEach(
          [runAttachment, queueAttachment, orphanAttachment],
          (attachment, index) =>
            service.bind({
              attachmentIds: [attachment.id],
              sessionId: 'session-a',
              ownerCallerId: `profile:${['run', 'queue', 'orphan'][index]}`,
            }),
        )
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          INSERT INTO session_runs (id, session_id, status, intent_json)
          VALUES (
            ${'run-a'}, ${'session-a'}, ${'starting'},
            ${JSON.stringify({ attachmentIds: [runAttachment.id] })}
          )
        `
        yield* sql`
          INSERT INTO session_follow_ups (id, session_id, intent_json)
          VALUES (
            ${'follow-up-a'}, ${'session-a'},
            ${JSON.stringify({ attachmentIds: [queueAttachment.id] })}
          )
        `
        yield* service.cleanupUnreferenced({ sessionId: 'session-a' })
        const retained = yield* sql<{ readonly id: string }>`
          SELECT id FROM session_prepared_attachments ORDER BY id
        `
        yield* sql`UPDATE session_runs SET status = ${'completed'} WHERE id = ${'run-a'}`
        yield* sql`DELETE FROM session_follow_ups WHERE id = ${'follow-up-a'}`
        yield* service.cleanupUnreferenced({ sessionId: 'session-a' })
        const remaining = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM session_prepared_attachments
        `
        return {
          retained: retained.map((row) => row.id),
          remaining: remaining[0]?.count,
          orphanId: orphanAttachment.id,
          referencedIds: [runAttachment.id, queueAttachment.id],
        }
      }).pipe(Effect.provide(testLayer(input.databasePath))),
    )

    expect(result.retained).toEqual([...result.referencedIds].sort())
    expect(result.retained).not.toContain(result.orphanId)
    expect(result.remaining).toBe(0)
  })
})
