import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { decodeUnknownExactOrThrow } from '@shared/schema'
import { decodeLocalSessionCommandPayloadForRevision } from '@shared/schemas/local-session-protocol'
import { agentSendPayloadSchema } from '@shared/schemas/validation'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { configureGuiSessionCommandClient } from '../../application/gui-session-command-router'
import { prepareLocalGuiAttachments } from '../../application/local-ui-session-service'
import { sessionControlAttachmentServiceLayer } from '../../adapters/session-control-attachment-service'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { runAppDatabaseMigrations } from '../../services/database-service'
import { createLocalSessionAuthenticator } from '../../session-host/local-session-authenticator'
import {
  type LocalSessionHostRuntime,
  startLocalSessionHost,
} from '../../session-host/local-session-host-runtime'
import {
  prepareLocalSessionHostPaths,
  resolveLocalSessionHostPaths,
} from '../../session-host/local-session-paths'
import { ensureLocalUserCredential } from '../../session-host/local-user-credential'
import {
  configurePreparedAttachmentRegistry,
  resetPreparedAttachmentRegistryForTests,
  resolvePreparedAttachmentCapability,
} from '../../utils/attachment-registry'
import {
  discardRegisteredImageAttachment,
  prepareRegisteredImageAttachmentFromBytes,
} from '../attachment-preparation'

const appUserData = vi.hoisted(() => ({ path: '/unused' }))

vi.mock('electron', () => ({ app: { getPath: () => '/unused' }, clipboard: {}, nativeImage: {} }))
vi.mock('../../desktop-shell/app-paths', () => ({
  appPaths: { userData: () => appUserData.path },
}))
// OCR is not what this test is about, and the real one needs a language model download.
vi.mock('../../utils/attachment-text-extraction', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/attachment-text-extraction')>()),
  extractAttachmentText: async () => 'OCR text',
}))

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

let root: string
let host: LocalSessionHostRuntime | undefined
let database: ManagedRuntime.ManagedRuntime<
  SqlClient.SqlClient | SessionControlAttachmentService,
  unknown
>
let paths: ReturnType<typeof resolveLocalSessionHostPaths>

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ow-pasted-image-host-')))
  appUserData.path = path.join(root, 'gui')
  paths = resolveLocalSessionHostPaths({ userDataRoot: root })
  const sqlLayer = SqliteClient.layer({ filename: path.join(root, 'attachments.sqlite') })
  database = ManagedRuntime.make(
    Layer.mergeAll(sqlLayer, sessionControlAttachmentServiceLayer().pipe(Layer.provide(sqlLayer))),
  )
  await database.runPromise(runAppDatabaseMigrations)
  await database.runPromise(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at) VALUES ('session-a', 'pi-a', 'A', 1, 2)`
    }),
  )
  await prepareLocalSessionHostPaths(paths)
  const credential = await ensureLocalUserCredential(paths.credentialPath)
  host = await startLocalSessionHost({
    endpoint: paths.endpoint,
    databasePath: paths.databasePath,
    idleGracePeriodMs: 60_000,
    authenticate: createLocalSessionAuthenticator({ localUserCredential: credential }),
    dispatch: async ({ caller, payload, negotiatedRevision }) => {
      const command = decodeLocalSessionCommandPayloadForRevision(payload, negotiatedRevision)
      if (command.contract !== 'local-attachments-v1') throw new Error('Unexpected Host request.')
      return database.runPromise(prepareLocalGuiAttachments({ caller, payload: command }))
    },
  })
  configureGuiSessionCommandClient({ paths, clientVersion: 'test' })
  configurePreparedAttachmentRegistry(appUserData.path)
})

afterEach(async () => {
  configureGuiSessionCommandClient(null)
  await host?.stop()
  host = undefined
  await database.dispose()
  resetPreparedAttachmentRegistryForTests()
  if (paths.endpointDirectory !== null && paths.endpointDirectory !== paths.stateRoot) {
    await fs.rm(paths.endpointDirectory, { recursive: true, force: true })
  }
  await fs.rm(root, { recursive: true, force: true })
})

function resolveThroughHost(attachmentIds: readonly string[]) {
  return database.runPromise(
    Effect.gen(function* () {
      const service = yield* SessionControlAttachmentService
      return yield* service.resolve({
        attachmentIds,
        sessionId: 'session-a',
        ownerCallerId: 'gui:local-user',
      })
    }),
  )
}

// A pasted screenshot has no path, so the window sends its bytes. The Session Host binds only the
// attachments it prepared, so an image prepared in the window alone attached and then failed to
// send with "Attachment capability was not found" (#465).
it('sends a pasted image the Session Host prepared, under the name it was pasted as', async () => {
  const attachment = await prepareRegisteredImageAttachmentFromBytes({
    bytes: PNG_BYTES,
    fileName: 'pasted-image.png',
    mimeType: 'image/png',
  })

  expect(attachment).toMatchObject({
    kind: 'image',
    origin: 'session-resource',
    name: 'pasted-image.png',
    mimeType: 'image/png',
    sizeBytes: PNG_BYTES.byteLength,
  })
  await expect(resolvePreparedAttachmentCapability(attachment)).resolves.toEqual(attachment)

  // The composer's send boundary: it submits capability IDs, which the Host binds to the Session.
  const submission = decodeUnknownExactOrThrow(agentSendPayloadSchema, {
    text: 'What is in this screenshot?',
    attachments: [attachment],
  })
  const [sent] = await resolveThroughHost(submission.attachments.map(({ id }) => id))

  expect(sent).toMatchObject({ id: attachment.id, name: 'pasted-image.png', kind: 'image' })
  expect(sent?.source?.value).toBe(PNG_BYTES.toString('base64'))
})

it('discards a pasted image and the private directory its copy was written to', async () => {
  const attachment = await prepareRegisteredImageAttachmentFromBytes({
    bytes: PNG_BYTES,
    fileName: 'pasted-image.png',
    mimeType: 'image/png',
  })

  await discardRegisteredImageAttachment(attachment)

  await expect(fs.stat(path.dirname(attachment.path))).rejects.toThrow('ENOENT')
  await expect(resolvePreparedAttachmentCapability(attachment)).rejects.toThrow(
    'Attachment was not prepared by this app',
  )
})
