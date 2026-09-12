import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionResourceStore } from '../../ports/session-resource-store'
import { makeFilesystemSessionResourceStoreLayer } from '../filesystem-session-resource-store'

let tmpRoot = ''

function sessionDirectory(sessionId: string) {
  return path.join(tmpRoot, createHash('sha256').update(sessionId).digest('hex'))
}

describe('FilesystemSessionResourceStore session confinement', () => {
  beforeEach(async () => {
    tmpRoot = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-resource-store-security-')),
    )
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('maps traversal-shaped session ids to a confined non-symlinked directory', async () => {
    const stored = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* SessionResourceStore
        return yield* store.storeBytes({
          sessionId: SessionId('../../outside'),
          resourceId: 'resource-1',
          fileName: 'image.png',
          bytes: new Uint8Array([1, 2, 3]),
        })
      }).pipe(Effect.provide(makeFilesystemSessionResourceStoreLayer(tmpRoot))),
    )

    expect(path.relative(tmpRoot, stored.path)).not.toMatch(/^\.\./u)
    expect((await fs.lstat(path.dirname(stored.path))).isSymbolicLink()).toBe(false)
  })

  it.skipIf(process.platform === 'win32')(
    'rejects managed paths that are symlinked outside the resource root',
    async () => {
      const outside = path.join(path.dirname(tmpRoot), 'outside-linked-session-resource.txt')
      const sessionDirectoryPath = sessionDirectory('session-1')
      const linkedPath = path.join(sessionDirectoryPath, 'linked-resource.png')
      await fs.writeFile(outside, 'secret')
      await fs.mkdir(sessionDirectoryPath, { recursive: true })
      await fs.symlink(outside, linkedPath)

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const store = yield* SessionResourceStore
          return yield* store.read(linkedPath)
        }).pipe(Effect.either, Effect.provide(makeFilesystemSessionResourceStoreLayer(tmpRoot))),
      )

      expect(result).toMatchObject({
        _tag: 'Left',
        left: { _tag: 'SessionResourceStoreError', operation: 'read' },
      })
      await fs.rm(outside, { force: true })
    },
  )

  it.skipIf(process.platform === 'win32')(
    'rejects an ancestor swapped to an outside symlink while opening',
    async () => {
      const stored = await Effect.runPromise(
        Effect.gen(function* () {
          const store = yield* SessionResourceStore
          return yield* store.storeBytes({
            sessionId: SessionId('session-1'),
            resourceId: 'resource-1',
            fileName: 'image.png',
            bytes: new Uint8Array([1, 2, 3]),
          })
        }).pipe(Effect.provide(makeFilesystemSessionResourceStoreLayer(tmpRoot))),
      )
      const outsideDirectory = await fs.mkdtemp(
        path.join(os.tmpdir(), 'openwaggle-resource-stream-race-'),
      )
      const movedDirectory = `${path.dirname(stored.path)}-moved`
      await fs.writeFile(path.join(outsideDirectory, path.basename(stored.path)), 'outside data')
      const originalOpen = fs.open.bind(fs)
      const open = vi.spyOn(fs, 'open').mockImplementation(async (filePath, flags, mode) => {
        await fs.rename(path.dirname(stored.path), movedDirectory)
        await fs.symlink(outsideDirectory, path.dirname(stored.path), 'dir')
        return mode === undefined
          ? originalOpen(filePath, flags)
          : originalOpen(filePath, flags, mode)
      })

      try {
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const store = yield* SessionResourceStore
            return yield* store.read(stored.path)
          }).pipe(Effect.either, Effect.provide(makeFilesystemSessionResourceStoreLayer(tmpRoot))),
        )

        expect(result).toMatchObject({
          _tag: 'Left',
          left: { _tag: 'SessionResourceStoreError', operation: 'read' },
        })
      } finally {
        open.mockRestore()
        await fs.rm(path.dirname(stored.path), { recursive: true, force: true })
        await fs.rename(movedDirectory, path.dirname(stored.path)).catch(() => undefined)
        await fs.rm(outsideDirectory, { recursive: true, force: true })
      }
    },
  )

  it('removes a validated managed file without affecting its sibling', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* SessionResourceStore
        const removed = yield* store.storeBytes({
          sessionId: SessionId('session-1'),
          resourceId: 'removed',
          fileName: 'removed.png',
          bytes: new Uint8Array([1]),
        })
        const sibling = yield* store.storeBytes({
          sessionId: SessionId('session-1'),
          resourceId: 'sibling',
          fileName: 'sibling.png',
          bytes: new Uint8Array([2]),
        })
        yield* store.remove(removed.path)
        return { removed: removed.path, sibling: sibling.path }
      }).pipe(Effect.provide(makeFilesystemSessionResourceStoreLayer(tmpRoot))),
    )

    await expect(fs.stat(result.removed)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(result.sibling)).resolves.toEqual(Buffer.from([2]))
  })

  it.skipIf(process.platform === 'win32')(
    'removes canonical and legacy lexical paths when the configured root is a symlink',
    async () => {
      const linkedRoot = path.join(tmpRoot, 'root-alias')
      await fs.symlink(tmpRoot, linkedRoot, 'dir')
      const storedPaths = await Effect.runPromise(
        Effect.gen(function* () {
          const store = yield* SessionResourceStore
          const canonical = yield* store.storeBytes({
            sessionId: SessionId('session-1'),
            resourceId: 'canonical',
            fileName: 'canonical.png',
            bytes: new Uint8Array([1, 2, 3]),
          })
          const legacy = yield* store.storeBytes({
            sessionId: SessionId('session-1'),
            resourceId: 'legacy',
            fileName: 'legacy.png',
            bytes: new Uint8Array([4, 5, 6]),
          })
          const legacyLexicalPath = path.join(linkedRoot, path.relative(tmpRoot, legacy.path))
          yield* store.remove(canonical.path)
          yield* store.remove(legacyLexicalPath)
          return [canonical.path, legacy.path]
        }).pipe(Effect.provide(makeFilesystemSessionResourceStoreLayer(linkedRoot))),
      )

      for (const storedPath of storedPaths) {
        await expect(fs.stat(storedPath)).rejects.toMatchObject({ code: 'ENOENT' })
      }
      await fs.rm(linkedRoot, { force: true })
    },
  )

  it.skipIf(process.platform === 'win32')(
    'rejects cleanup through a symlinked managed-directory ancestor',
    async () => {
      const outsideDirectory = await fs.mkdtemp(
        path.join(os.tmpdir(), 'openwaggle-resource-store-outside-'),
      )
      const victim = path.join(outsideDirectory, 'victim.png')
      const linkedSessionDirectory = sessionDirectory('session-1')
      await fs.writeFile(victim, 'outside data')
      await fs.symlink(outsideDirectory, linkedSessionDirectory, 'dir')

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const store = yield* SessionResourceStore
          return yield* store.remove(path.join(linkedSessionDirectory, 'victim.png'))
        }).pipe(Effect.either, Effect.provide(makeFilesystemSessionResourceStoreLayer(tmpRoot))),
      )

      expect(result).toMatchObject({
        _tag: 'Left',
        left: { _tag: 'SessionResourceStoreError', operation: 'remove' },
      })
      await expect(fs.readFile(victim, 'utf8')).resolves.toBe('outside data')
      await fs.rm(outsideDirectory, { recursive: true, force: true })
    },
  )
})
