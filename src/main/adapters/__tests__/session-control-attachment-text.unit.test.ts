import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { ATTACHMENT } from '@shared/constants/resource-limits'
import { decodeUnknownExactOrThrow } from '@shared/schema'
import { agentSendPayloadSchema } from '@shared/schemas/validation'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { expect, it } from 'vitest'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { SESSION_ATTACHMENT_TARGET_SCHEMA_STATEMENTS } from '../../services/session-host-attachment-schema'
import { SESSION_HOST_BROWSER_ATTACHMENT_MIGRATION } from '../../services/session-host-browser-attachment-migration'
import { decodeLocalSessionCommandResponse } from '../../session-host/local-session-client-response'
import { sessionControlAttachmentServiceLayer } from '../session-control-attachment-service'

it('submits a bounded paste preview while resolving the full immutable Host snapshot', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-paste-snapshot-'))
  const source = path.join(root, 'prompt.md')
  const longText = `  ${'long paste\n'.repeat(40_000)}END OF ORIGINAL PASTE  `
  await fs.writeFile(source, longText)
  const sqlite = SqliteClient.layer({ filename: path.join(root, 'session-host.db') })
  try {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql.unsafe('CREATE TABLE sessions (id TEXT PRIMARY KEY)')
        for (const statement of [
          ...SESSION_ATTACHMENT_TARGET_SCHEMA_STATEMENTS,
          ...SESSION_HOST_BROWSER_ATTACHMENT_MIGRATION.statements,
        ]) {
          yield* sql.unsafe(statement)
        }
        yield* sql`INSERT INTO sessions (id) VALUES (${'session-a'})`
        const service = yield* SessionControlAttachmentService
        const attachments = yield* service.prepare({
          baseDirectory: root,
          entries: [{ path: source, origin: 'auto-paste-text' }],
          ownerCallerId: 'gui:local-user',
          requestId: 'prepare-paste',
        })
        const decoded = decodeLocalSessionCommandResponse(
          {
            kind: 'response',
            requestId: 'prepare-paste',
            payload: {
              contract: 'local-attachments-v1',
              response: { requestId: 'prepare-paste', attachments },
            },
          },
          'prepare-paste',
        )
        if (decoded.contract !== 'local-attachments-v1') {
          return yield* Effect.die('Expected an attachment response.')
        }
        const submission = decodeUnknownExactOrThrow(agentSendPayloadSchema, {
          text: '',
          thinkingLevel: 'off',
          attachments: decoded.response.attachments.map((attachment) => ({
            ...attachment,
            name: 'Pasted Text 1.md',
          })),
        })
        yield* Effect.promise(() => fs.writeFile(source, 'changed after preparation'))
        const resolved = yield* service.resolve({
          attachmentIds: submission.attachments.map((attachment) => attachment.id),
          sessionId: 'session-a',
          ownerCallerId: 'gui:local-user',
        })
        return { publicAttachment: submission.attachments[0], resolved: resolved[0] }
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            sqlite,
            sessionControlAttachmentServiceLayer().pipe(Layer.provide(sqlite)),
          ),
        ),
      ),
    )
    expect(result.publicAttachment?.extractedText.length).toBe(ATTACHMENT.MAX_EXTRACTED_TEXT_CHARS)
    expect(result.publicAttachment?.extractedText).toMatch(/\n\.\.\.\[truncated\]$/)
    expect(result.publicAttachment).not.toHaveProperty('immutableSourceBase64')
    expect(result.resolved?.extractedText).toBe(longText)
    expect(result.resolved?.sizeBytes).toBe(Buffer.byteLength(longText))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
