import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, expect, it, vi } from 'vitest'
import { makeFilesystemInlineVisualizationService } from '../../adapters/filesystem-inline-visualization-service'
import { InlineVisualizationService } from '../../ports/inline-visualization-service'
import { SessionRepository, type SessionRepositoryShape } from '../../ports/session-repository'
import { resolveLocalSessionHostPaths } from '../../session-host/local-session-paths'
import { configureGuiSessionCommandClient } from '../gui-session-command-router'
import { readInlineVisualizationSource } from '../inline-visualization-source-service'

const { executeConfiguredHostUi } = vi.hoisted(() => ({ executeConfiguredHostUi: vi.fn() }))
vi.mock('../configured-host-ui-client', () => ({ executeConfiguredHostUi }))

let temporaryRoot = ''
afterEach(async () => {
  configureGuiSessionCommandClient(null)
  if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true })
})

it('does not restore a Host-active deletion after an in-flight ownership reply', async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-visualization-readonly-'))
  const sessionId = SessionId('deleting-visualization')
  const filesystem = makeFilesystemInlineVisualizationService(temporaryRoot)
  const directory = await Effect.runPromise(filesystem.prepareSession(sessionId))
  const sourcePath = path.join(directory, 'deleted-map.html')
  await fs.writeFile(sourcePath, '<main>Delete me</main>')
  configureGuiSessionCommandClient({
    paths: resolveLocalSessionHostPaths({ userDataRoot: temporaryRoot }),
    clientVersion: 'test',
  })
  const capturedReply = Promise.withResolvers<unknown>()
  executeConfiguredHostUi.mockReturnValue(capturedReply.promise)
  const layer = Layer.merge(
    Layer.succeed(
      SessionRepository,
      fromPartial<SessionRepositoryShape>({ getTree: () => Effect.succeed(null) }),
    ),
    Layer.succeed(InlineVisualizationService, filesystem),
  )
  const reading = Effect.runPromise(
    readInlineVisualizationSource({ sessionId, sourcePath }).pipe(Effect.provide(layer)),
  )
  await vi.waitFor(() => expect(executeConfiguredHostUi).toHaveBeenCalledOnce())

  // Separate module state reproduces the Host's process-local active-deletion lock.
  vi.resetModules()
  const host = await import('../../adapters/filesystem-inline-visualization-deletion')
  const staged = await host.stageVisualizationSessionDeletion(temporaryRoot, sessionId)
  capturedReply.resolve({ id: sessionId, projectPath: null })
  const result = await reading
  const directoryRestoredByRead = await fs.stat(directory).then(
    () => true,
    () => false,
  )
  await host.commitDeletionTombstone(staged.tombstone, staged.directory, staged.staged)

  expect(result.status).toBe('unavailable')
  expect(directoryRestoredByRead).toBe(false)
  await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(fs.stat(staged.tombstone)).rejects.toMatchObject({ code: 'ENOENT' })
})
