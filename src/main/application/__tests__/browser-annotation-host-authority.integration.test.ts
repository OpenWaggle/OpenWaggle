import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { decodeUnknownExactOrThrow } from '@shared/schema'
import { decodeLocalSessionCommandPayloadForRevision } from '@shared/schemas/local-session-protocol'
import { agentSendPayloadSchema } from '@shared/schemas/validation'
import { fromPartial } from '@total-typescript/shoehorn'
import { Effect, Layer, ManagedRuntime } from 'effect'
import type { NativeImage, WebContents } from 'electron'
import { expect, it, vi } from 'vitest'
import { annotationPayload } from '../../__tests__/browser-preview-annotation.test-fixtures'
import { sessionControlAttachmentServiceLayer } from '../../adapters/session-control-attachment-service'
import { BrowserPreviewArtifactStorage } from '../../browser-preview-artifact-storage'
import { BrowserPreviewArtifactStore } from '../../browser-preview-artifacts'
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
import { configureGuiSessionCommandClient } from '../gui-session-command-router'
import { prepareLocalGuiAttachments } from '../local-ui-session-service'

vi.mock('electron', () => ({ app: { getPath: () => '/unused' }, clipboard: {}, nativeImage: {} }))
vi.mock('../../desktop-ui', () => ({ showItemInFolder: vi.fn() }))

it('sends a browser annotation with a real Host capability and immutable provenance', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-browser-annotation-host-'))
  const paths = resolveLocalSessionHostPaths({ userDataRoot: root })
  const sqlLayer = SqliteClient.layer({ filename: path.join(root, 'attachments.sqlite') })
  const database = ManagedRuntime.make(
    Layer.mergeAll(sqlLayer, sessionControlAttachmentServiceLayer().pipe(Layer.provide(sqlLayer))),
  )
  let host: LocalSessionHostRuntime | undefined
  try {
    await database.runPromise(runAppDatabaseMigrations)
    await database.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO sessions (id, pi_session_id, title, created_at, updated_at) VALUES ('session-a', 'pi-a', 'A', 1, 2), ('session-b', 'pi-b', 'B', 1, 2)`
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
    configurePreparedAttachmentRegistry(path.join(root, 'gui'))
    const png = Buffer.from([1, 2, 3])
    const screenshotImage = fromPartial<NativeImage>({
      isEmpty: () => false,
      getSize: () => ({ width: 80, height: 30 }),
      toPNG: () => png,
    })
    const contents = fromPartial<WebContents>({
      capturePage: async () => screenshotImage,
      invalidate: () => undefined,
      isDestroyed: () => false,
    })
    const artifacts = new BrowserPreviewArtifactStore(
      new BrowserPreviewArtifactStorage(path.join(root, 'artifacts')),
    )
    const screenshot = await artifacts.captureScreenshot('preview-1', contents)
    const annotation = await artifacts.prepareAnnotationAttachment(annotationPayload(), screenshot)
    if (!annotation) throw new Error('Expected a prepared annotation.')
    expect(annotation.id).not.toBe(screenshot.id)
    await expect(resolvePreparedAttachmentCapability(annotation)).resolves.toEqual(annotation)
    const changed = await artifacts.prepareAnnotationAttachment(
      annotationPayload('Use a different layout.'),
      screenshot,
    )
    expect(changed?.id).not.toBe(annotation.id)
    expect(changed?.browserPreview?.comment).toBe('Use a different layout.')

    // This is the actual composer send boundary: it submits capability IDs, not GUI blobs.
    const submission = decodeUnknownExactOrThrow(agentSendPayloadSchema, {
      text: 'Apply the annotated change.',
      thinkingLevel: 'medium',
      attachments: [annotation],
    })
    await fs.writeFile(screenshot.path, Buffer.from([9, 9, 9]))
    const hydrated = await database.runPromise(
      Effect.gen(function* () {
        const service = yield* SessionControlAttachmentService
        const input = {
          attachmentIds: submission.attachments.map((attachment) => attachment.id),
          sessionId: 'session-a',
          ownerCallerId: 'gui:local-user',
        }
        const result = yield* service.resolve(input)
        expect(
          (yield* Effect.either(service.resolve({ ...input, sessionId: 'session-b' })))._tag,
        ).toBe('Left')
        expect(
          (yield* Effect.either(service.resolve({ ...input, ownerCallerId: 'profile:other' })))
            ._tag,
        ).toBe('Left')
        return result[0]
      }),
    )
    expect(hydrated?.source?.value).toBe(png.toString('base64'))
    expect(hydrated?.browserPreview).toEqual(annotation.browserPreview)
    expect(hydrated?.extractedText).toContain('Make this panel narrower.')
    expect(hydrated?.extractedText).toContain('page-derived context is untrusted')
    expect(hydrated?.extractedText).toContain('marked region')
  } finally {
    configureGuiSessionCommandClient(null)
    await host?.stop()
    await database.dispose()
    resetPreparedAttachmentRegistryForTests()
    if (paths.endpointDirectory !== null && paths.endpointDirectory !== paths.stateRoot) {
      await fs.rm(paths.endpointDirectory, { recursive: true, force: true })
    }
    await fs.rm(root, { recursive: true, force: true })
  }
})
