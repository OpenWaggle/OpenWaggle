import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it } from 'vitest'
import { makeFilesystemInlineVisualizationService } from '../filesystem-inline-visualization-service'

const temporaryRoots: string[] = []

async function makeTemporaryRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-visualization-test-'))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  )
})

describe('FilesystemInlineVisualizationService', () => {
  it('reads a conforming live source from the producing session root', async () => {
    const userDataPath = await makeTemporaryRoot()
    const service = makeFilesystemInlineVisualizationService(userDataPath)
    const sessionId = SessionId('session-visualization-1')
    const sessionRoot = await Effect.runPromise(service.prepareSession(sessionId))
    const sourcePath = path.join(sessionRoot, 'latency-map.html')
    const contents = '<div id="latency-map">Ready</div>\n'
    await fs.writeFile(sourcePath, contents, 'utf8')

    await expect(
      Effect.runPromise(service.readSource({ sessionId, sourcePath, workspaceRoots: [] })),
    ).resolves.toEqual({ status: 'loaded', contents, sizeBytes: Buffer.byteLength(contents) })
  })

  it('rejects a session file that is a symlink to content outside the session root', async () => {
    const userDataPath = await makeTemporaryRoot()
    const service = makeFilesystemInlineVisualizationService(userDataPath)
    const sessionId = SessionId('session-visualization-1')
    const sessionRoot = await Effect.runPromise(service.prepareSession(sessionId))
    const outsidePath = path.join(userDataPath, 'outside.html')
    const sourcePath = path.join(sessionRoot, 'escape.html')
    await fs.writeFile(outsidePath, '<script>stealSecrets()</script>', 'utf8')
    await fs.symlink(outsidePath, sourcePath)

    await expect(
      Effect.runPromise(service.readSource({ sessionId, sourcePath, workspaceRoots: [] })),
    ).resolves.toEqual({ status: 'unavailable', reason: 'invalid-path' })
  })

  it('rejects an intermediate-directory swap between authorization and open', async () => {
    const userDataPath = await makeTemporaryRoot()
    const workspaceRoot = await makeTemporaryRoot()
    const outsideRoot = await makeTemporaryRoot()
    const sourceDirectory = path.join(workspaceRoot, 'maps')
    const movedDirectory = path.join(workspaceRoot, 'maps-before-swap')
    const sourcePath = path.join(sourceDirectory, 'security-map.html')
    await fs.mkdir(sourceDirectory)
    await fs.writeFile(sourcePath, '<p>Authorized</p>', 'utf8')
    await fs.writeFile(path.join(outsideRoot, 'security-map.html'), '<p>Secret</p>', 'utf8')
    const service = makeFilesystemInlineVisualizationService(userDataPath, {
      beforeSourceOpen: async () => {
        await fs.rename(sourceDirectory, movedDirectory)
        await fs.symlink(outsideRoot, sourceDirectory)
      },
    })

    await expect(
      Effect.runPromise(
        service.readSource({
          sessionId: SessionId('session-visualization-1'),
          sourcePath,
          workspaceRoots: [workspaceRoot],
        }),
      ),
    ).resolves.toEqual({ status: 'unavailable', reason: 'invalid-path' })
  })

  it('rejects filenames outside the lowercase hyphenated HTML contract', async () => {
    const userDataPath = await makeTemporaryRoot()
    const service = makeFilesystemInlineVisualizationService(userDataPath)
    const sessionId = SessionId('session-visualization-1')
    const sessionRoot = await Effect.runPromise(service.prepareSession(sessionId))
    const sourcePath = path.join(sessionRoot, 'Latency Map.HTML')
    await fs.writeFile(sourcePath, '<p>Not conforming</p>', 'utf8')

    await expect(
      Effect.runPromise(service.readSource({ sessionId, sourcePath, workspaceRoots: [] })),
    ).resolves.toEqual({ status: 'unavailable', reason: 'invalid-path' })
  })

  it('rejects visualization sources larger than the defensive host limit', async () => {
    const userDataPath = await makeTemporaryRoot()
    const service = makeFilesystemInlineVisualizationService(userDataPath)
    const sessionId = SessionId('session-visualization-1')
    const sessionRoot = await Effect.runPromise(service.prepareSession(sessionId))
    const sourcePath = path.join(sessionRoot, 'oversized.html')
    await fs.writeFile(sourcePath, Buffer.alloc(5 * 1024 * 1024 + 1, 32))

    await expect(
      Effect.runPromise(service.readSource({ sessionId, sourcePath, workspaceRoots: [] })),
    ).resolves.toEqual({ status: 'unavailable', reason: 'too-large' })
  })

  it('reads a conforming live source under an explicitly authorized workspace root', async () => {
    const userDataPath = await makeTemporaryRoot()
    const workspaceRoot = await makeTemporaryRoot()
    const service = makeFilesystemInlineVisualizationService(userDataPath)
    const sessionId = SessionId('session-visualization-1')
    const sourceDirectory = path.join(workspaceRoot, '.openwaggle', 'visualizations')
    const sourcePath = path.join(sourceDirectory, 'dependency-map.html')
    const contents = '<main>Dependency map</main>\n'
    await fs.mkdir(sourceDirectory, { recursive: true })
    await fs.writeFile(sourcePath, contents, 'utf8')

    await expect(
      Effect.runPromise(
        service.readSource({ sessionId, sourcePath, workspaceRoots: [workspaceRoot] }),
      ),
    ).resolves.toEqual({ status: 'loaded', contents, sizeBytes: Buffer.byteLength(contents) })
  })

  it('rejects a session identifier that could escape the visualization storage root', async () => {
    const userDataPath = await makeTemporaryRoot()
    const service = makeFilesystemInlineVisualizationService(userDataPath)

    await expect(
      Effect.runPromise(service.prepareSession(SessionId('../../escape'))),
    ).rejects.toThrow('Invalid visualization session identifier')
  })

  it('refuses to prepare a session below a symlinked visualization storage root', async () => {
    const userDataPath = await makeTemporaryRoot()
    const outsideRoot = await makeTemporaryRoot()
    await fs.symlink(outsideRoot, path.join(userDataPath, 'visualizations'))
    const service = makeFilesystemInlineVisualizationService(userDataPath)

    await expect(
      Effect.runPromise(service.prepareSession(SessionId('session-visualization-1'))),
    ).rejects.toThrow('Invalid visualization storage root')
  })

  it('deletes visualization sources when their owning session is deleted', async () => {
    const userDataPath = await makeTemporaryRoot()
    const service = makeFilesystemInlineVisualizationService(userDataPath)
    const sessionId = SessionId('session-visualization-1')
    const sessionRoot = await Effect.runPromise(service.prepareSession(sessionId))
    await fs.writeFile(path.join(sessionRoot, 'persistent-map.html'), '<p>Saved</p>', 'utf8')

    await Effect.runPromise(service.deleteSession(sessionId))

    await expect(fs.stat(sessionRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('can restore or commit a staged session deletion', async () => {
    const userDataPath = await makeTemporaryRoot()
    const service = makeFilesystemInlineVisualizationService(userDataPath)
    const sessionId = SessionId('session-visualization-1')
    const sessionRoot = await Effect.runPromise(service.prepareSession(sessionId))
    const sourcePath = path.join(sessionRoot, 'persistent-map.html')
    await fs.writeFile(sourcePath, '<p>Saved</p>', 'utf8')

    const firstStage = await Effect.runPromise(service.stageSessionDeletion(sessionId))
    await expect(fs.stat(sessionRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    await Effect.runPromise(firstStage.rollback)
    await expect(fs.readFile(sourcePath, 'utf8')).resolves.toBe('<p>Saved</p>')

    const secondStage = await Effect.runPromise(service.stageSessionDeletion(sessionId))
    await Effect.runPromise(secondStage.commit)
    await expect(fs.stat(sessionRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
