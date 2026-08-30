import { createHash } from 'node:crypto'
import type * as SqlClient from '@effect/sql/SqlClient'
import type { AttachmentKind, AttachmentOrigin, PreparedAttachment } from '@shared/types/agent'
import * as Effect from 'effect/Effect'
import type { SessionControlAttachmentServiceShape } from '../ports/session-control-attachment-service'
import {
  type PreparedAttachmentSnapshot,
  prepareAttachmentFiles,
} from '../utils/attachment-preparation'
import type { AttachmentStoragePolicy } from './session-control-attachment-service'

interface PreparedAttachmentRow {
  readonly id: string
  readonly kind: AttachmentKind
  readonly origin: AttachmentOrigin
  readonly name: string
  readonly real_path: string
  readonly mime_type: string
  readonly size_bytes: number
  readonly source_base64: string
  readonly extracted_text: string
}

interface StoredBytesRow {
  readonly bytes: number
}
interface AttachmentIntentRow {
  readonly intent_json: string
}

function cleanupExpiredAttachments(sql: SqlClient.SqlClient, now: number) {
  return sql`DELETE FROM session_prepared_attachments WHERE expires_at IS NOT NULL AND expires_at <= ${now}`
}

function assertStorageQuota(
  sql: SqlClient.SqlClient,
  ownerCallerId: string,
  policy: AttachmentStoragePolicy,
) {
  return Effect.gen(function* () {
    const global =
      yield* sql<StoredBytesRow>`SELECT COALESCE(SUM(LENGTH(source_base64)), 0) AS bytes FROM session_prepared_attachments`
    if ((global[0]?.bytes ?? 0) > policy.maxStoredBytesGlobal) {
      return yield* Effect.fail(
        new Error('The global prepared attachment storage quota was reached.'),
      )
    }
    const owner = yield* sql<StoredBytesRow>`
      SELECT COALESCE(SUM(LENGTH(source_base64)), 0) AS bytes FROM session_prepared_attachments
      WHERE owner_caller_id = ${ownerCallerId} AND session_id IS NULL
    `
    if ((owner[0]?.bytes ?? 0) > policy.maxUnboundBytesPerOwner) {
      return yield* Effect.fail(
        new Error('The caller prepared attachment storage quota was reached.'),
      )
    }
  })
}

function stableAttachmentId(input: {
  readonly ownerCallerId: string
  readonly requestId: string
  readonly index: number
  readonly attachment: PreparedAttachmentSnapshot
}) {
  return `attachment-${createHash('sha256')
    .update('openwaggle-prepared-attachment-v1\0')
    .update(input.ownerCallerId)
    .update('\0')
    .update(input.requestId)
    .update('\0')
    .update(String(input.index))
    .update('\0')
    .update(input.attachment.origin ?? 'user-file')
    .update('\0')
    .update(input.attachment.path)
    .update('\0')
    .update(input.attachment.mimeType)
    .update('\0')
    .update(input.attachment.immutableSourceBase64)
    .digest('hex')}`
}

function attachmentFromRow(row: PreparedAttachmentRow): PreparedAttachment {
  return {
    id: row.id,
    kind: row.kind,
    origin: row.origin,
    name: row.name,
    path: row.real_path,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    extractedText: row.extracted_text,
  }
}

function bindAttachments(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionControlAttachmentServiceShape['bind']>[0],
) {
  if (input.attachmentIds.length === 0) return Effect.void
  return sql.withTransaction(
    Effect.gen(function* () {
      const now = Date.now()
      yield* cleanupExpiredAttachments(sql, now)
      const selected = yield* sql<{ readonly id: string; readonly session_id: string | null }>`
      SELECT id, session_id FROM session_prepared_attachments
      WHERE id IN ${sql.in(input.attachmentIds)} AND owner_caller_id = ${input.ownerCallerId}
    `
      if (selected.some((row) => row.session_id && row.session_id !== input.sessionId)) {
        return yield* Effect.fail(
          new Error('Attachment capability is already bound to another Session.'),
        )
      }
      const selectedIds = new Set(selected.map((row) => row.id))
      const missing = input.attachmentIds.find((id) => !selectedIds.has(id))
      if (missing)
        return yield* Effect.fail(new Error(`Attachment capability was not found: ${missing}`))
      yield* sql`
      UPDATE session_prepared_attachments
      SET session_id = ${input.sessionId}, bound_at = COALESCE(bound_at, ${now}), expires_at = ${null}
      WHERE id IN ${sql.in(input.attachmentIds)} AND owner_caller_id = ${input.ownerCallerId}
    `
    }),
  )
}

function referencedAttachmentIds(rows: readonly AttachmentIntentRow[]) {
  const referenced = new Set<string>()
  for (const row of rows) {
    const intent: unknown = JSON.parse(row.intent_json)
    if (typeof intent !== 'object' || intent === null || !('attachmentIds' in intent))
      throw new Error('A retained Session intent has no attachment capability list.')
    const attachmentIds = intent.attachmentIds
    if (!Array.isArray(attachmentIds) || !attachmentIds.every((id) => typeof id === 'string'))
      throw new Error('A retained Session intent has an invalid attachment capability list.')
    for (const id of attachmentIds) referenced.add(id)
  }
  return referenced
}

function cleanupUnreferenced(sql: SqlClient.SqlClient, sessionId: string) {
  return sql.withTransaction(
    Effect.gen(function* () {
      const rows = yield* sql<AttachmentIntentRow>`
      SELECT intent_json FROM session_runs WHERE session_id = ${sessionId}
        AND status IN (${'starting'}, ${'active'}, ${'stopping'}) AND intent_json IS NOT NULL
      UNION ALL SELECT intent_json FROM session_follow_ups WHERE session_id = ${sessionId}
    `
      const referenced = yield* Effect.try({
        try: () => referencedAttachmentIds(rows),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      })
      if (referenced.size === 0) {
        yield* sql`DELETE FROM session_prepared_attachments WHERE session_id = ${sessionId}`
        return
      }
      yield* sql`DELETE FROM session_prepared_attachments WHERE session_id = ${sessionId} AND id NOT IN ${sql.in([...referenced])}`
    }),
  )
}

function prepareAttachments(
  sql: SqlClient.SqlClient,
  policy: AttachmentStoragePolicy,
  input: Parameters<SessionControlAttachmentServiceShape['prepare']>[0],
) {
  return Effect.tryPromise({
    try: () => prepareAttachmentFiles(input),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  }).pipe(
    Effect.flatMap((attachments) => {
      const stable = attachments.map((attachment, index) => ({
        ...attachment,
        id: stableAttachmentId({
          ownerCallerId: input.ownerCallerId,
          requestId: input.requestId,
          index,
          attachment,
        }),
      }))
      const now = Date.now()
      return sql
        .withTransaction(
          Effect.gen(function* () {
            yield* cleanupExpiredAttachments(sql, now)
            yield* Effect.forEach(
              stable,
              (attachment) => sql`
          INSERT INTO session_prepared_attachments (
            id, owner_caller_id, preparation_request_id, session_id, kind, origin, name, real_path,
            mime_type, size_bytes, source_base64, extracted_text, created_at, bound_at, expires_at
          ) VALUES (
            ${attachment.id}, ${input.ownerCallerId}, ${input.requestId}, ${null}, ${attachment.kind},
            ${attachment.origin ?? 'user-file'}, ${attachment.name}, ${attachment.path},
            ${attachment.mimeType}, ${attachment.sizeBytes}, ${attachment.immutableSourceBase64},
            ${attachment.extractedText}, ${now}, ${null}, ${now + policy.unboundTtlMs}
          ) ON CONFLICT(id) DO NOTHING
        `,
            )
            yield* assertStorageQuota(sql, input.ownerCallerId, policy)
          }),
        )
        .pipe(Effect.as(stable))
    }),
  )
}

function resolveAttachments(
  sql: SqlClient.SqlClient,
  input: Parameters<SessionControlAttachmentServiceShape['resolve']>[0],
) {
  return Effect.gen(function* () {
    if (input.attachmentIds.length === 0) return []
    yield* bindAttachments(sql, input)
    const rows = yield* sql<PreparedAttachmentRow>`
      SELECT id, kind, origin, name, real_path, mime_type, size_bytes, source_base64, extracted_text
      FROM session_prepared_attachments WHERE id IN ${sql.in(input.attachmentIds)}
        AND owner_caller_id = ${input.ownerCallerId}
    `
    const byId = new Map(rows.map((row) => [row.id, row]))
    return input.attachmentIds.map((id) => {
      const row = byId.get(id)
      if (!row) throw new Error(`Attachment capability was not found: ${id}`)
      const attachment = attachmentFromRow(row)
      if (attachment.kind !== 'image' && attachment.kind !== 'pdf')
        return { ...attachment, source: null }
      return {
        ...attachment,
        source: { type: 'data' as const, value: row.source_base64, mimeType: attachment.mimeType },
      }
    })
  })
}

export function createSessionControlAttachmentService(
  sql: SqlClient.SqlClient,
  policy: AttachmentStoragePolicy,
) {
  return {
    prepare: (input: Parameters<SessionControlAttachmentServiceShape['prepare']>[0]) =>
      prepareAttachments(sql, policy, input),
    bind: (input: Parameters<SessionControlAttachmentServiceShape['bind']>[0]) =>
      bindAttachments(sql, input),
    cleanupUnreferenced: (
      input: Parameters<SessionControlAttachmentServiceShape['cleanupUnreferenced']>[0],
    ) => cleanupUnreferenced(sql, input.sessionId),
    resolve: (input: Parameters<SessionControlAttachmentServiceShape['resolve']>[0]) =>
      resolveAttachments(sql, input),
    release: (input: Parameters<SessionControlAttachmentServiceShape['release']>[0]) =>
      input.attachmentIds.length === 0
        ? Effect.void
        : sql`
      DELETE FROM session_prepared_attachments WHERE id IN ${sql.in(input.attachmentIds)}
        AND session_id = ${input.sessionId} AND owner_caller_id = ${input.ownerCallerId}
    `.pipe(Effect.asVoid),
  } satisfies SessionControlAttachmentServiceShape
}
