import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionResourceStore } from '../../ports/session-resource-store'
import { makeFilesystemSessionResourceStoreLayer } from '../filesystem-session-resource-store'

let tmpRoot = ''

describe('FilesystemSessionResourceStore', () => {
  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-resource-store-'))
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('stores and reads bytes under a session-owned sanitized path', async () => {
    const bytes = new TextEncoder().encode('image bytes')
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* SessionResourceStore
        const stored = yield* store.storeBytes({
          sessionId: SessionId('session-1'),
          resourceId: 'resource-1',
          fileName: '../unsafe image.png',
          bytes,
        })
        const read = yield* store.read(stored.path)
        return { stored, read }
      }).pipe(Effect.provide(makeFilesystemSessionResourceStoreLayer(tmpRoot))),
    )

    expect(result.stored.path).toBe(path.join(tmpRoot, 'session-1', 'resource-1-unsafe-image.png'))
    expect(result.stored.sha256).toHaveLength(64)
    expect([...result.read]).toEqual([...bytes])
  })

  it('truncates long managed names without losing the file extension', async () => {
    const bytes = new TextEncoder().encode('long-name bytes')
    const stored = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* SessionResourceStore
        return yield* store.storeBytes({
          sessionId: SessionId('session-1'),
          resourceId: '123e4567-e89b-12d3-a456-426614174000',
          fileName: `${'a'.repeat(220)}.png`,
          bytes,
        })
      }).pipe(Effect.provide(makeFilesystemSessionResourceStoreLayer(tmpRoot))),
    )

    const managedName = path.basename(stored.path)
    expect(Buffer.byteLength(managedName)).toBeLessThanOrEqual(251)
    expect(managedName).toMatch(/\.png$/u)
    await expect(fs.readFile(stored.path)).resolves.toEqual(Buffer.from(bytes))
  })

  it('removes its temporary byte file when finalization fails', async () => {
    const sessionDirectory = path.join(tmpRoot, 'session-1')
    const targetName = 'resource-1-image.png'
    await fs.mkdir(path.join(sessionDirectory, targetName), { recursive: true })

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* SessionResourceStore
        return yield* store.storeBytes({
          sessionId: SessionId('session-1'),
          resourceId: 'resource-1',
          fileName: 'image.png',
          bytes: new Uint8Array([1, 2, 3]),
        })
      }).pipe(Effect.either, Effect.provide(makeFilesystemSessionResourceStoreLayer(tmpRoot))),
    )

    expect(result).toMatchObject({
      _tag: 'Left',
      left: { _tag: 'SessionResourceStoreError', operation: 'storeBytes' },
    })
    await expect(fs.readdir(sessionDirectory)).resolves.toEqual([targetName])
  })

  it('streams a source file into managed storage when its size is unchanged', async () => {
    const bytes = Buffer.from('unchanged attachment')
    const sourcePath = path.join(tmpRoot, 'source-attachment.txt')
    await fs.writeFile(sourcePath, bytes)

    const stored = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* SessionResourceStore
        return yield* store.storeFile({
          sessionId: SessionId('session-1'),
          resourceId: 'resource-1',
          fileName: 'attachment.txt',
          sourcePath,
          expectedSizeBytes: bytes.byteLength,
          maxSizeBytes: bytes.byteLength,
        })
      }).pipe(Effect.provide(makeFilesystemSessionResourceStoreLayer(tmpRoot))),
    )

    expect(stored.sizeBytes).toBe(bytes.byteLength)
    expect(stored.sha256).toHaveLength(64)
    await expect(fs.readFile(stored.path)).resolves.toEqual(bytes)
  })

  it('rejects a source file that grew beyond its expected size', async () => {
    const sourcePath = path.join(tmpRoot, 'grown-attachment.txt')
    await fs.writeFile(sourcePath, '12345')

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* SessionResourceStore
        return yield* store.storeFile({
          sessionId: SessionId('session-1'),
          resourceId: 'resource-1',
          fileName: 'attachment.txt',
          sourcePath,
          expectedSizeBytes: 4,
          maxSizeBytes: 8,
        })
      }).pipe(Effect.either, Effect.provide(makeFilesystemSessionResourceStoreLayer(tmpRoot))),
    )

    expect(result).toMatchObject({
      _tag: 'Left',
      left: { _tag: 'SessionResourceStoreError', operation: 'storeFile' },
    })
    await expect(fs.readdir(path.join(tmpRoot, 'session-1'))).resolves.toEqual([])
  })

  it('rejects a source file whose expected size exceeds the copy limit', async () => {
    const sourcePath = path.join(tmpRoot, 'oversized-attachment.txt')
    await fs.writeFile(sourcePath, '123456789')

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* SessionResourceStore
        return yield* store.storeFile({
          sessionId: SessionId('session-1'),
          resourceId: 'resource-1',
          fileName: 'attachment.txt',
          sourcePath,
          expectedSizeBytes: 9,
          maxSizeBytes: 8,
        })
      }).pipe(Effect.either, Effect.provide(makeFilesystemSessionResourceStoreLayer(tmpRoot))),
    )

    expect(result).toMatchObject({
      _tag: 'Left',
      left: { _tag: 'SessionResourceStoreError', operation: 'storeFile' },
    })
    await expect(fs.readdir(path.join(tmpRoot, 'session-1'))).resolves.toEqual([])
  })

  it('rejects reads that resolve outside the managed resource root', async () => {
    const outside = path.join(path.dirname(tmpRoot), 'outside-session-resource.txt')
    await fs.writeFile(outside, 'secret')

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* SessionResourceStore
        return yield* store.read(outside)
      }).pipe(Effect.either, Effect.provide(makeFilesystemSessionResourceStoreLayer(tmpRoot))),
    )

    expect(result).toMatchObject({
      _tag: 'Left',
      left: { _tag: 'SessionResourceStoreError', operation: 'read' },
    })

    await fs.rm(outside, { force: true })
  })

  it('removes only the requested session directory', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* SessionResourceStore
        for (const sessionId of [SessionId('session-1'), SessionId('session-2')]) {
          yield* store.storeBytes({
            sessionId,
            resourceId: 'resource',
            fileName: 'image.png',
            bytes: new Uint8Array([1, 2, 3]),
          })
        }
        yield* store.removeSession(SessionId('session-1'))
      }).pipe(Effect.provide(makeFilesystemSessionResourceStoreLayer(tmpRoot))),
    )

    await expect(fs.stat(path.join(tmpRoot, 'session-1'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(path.join(tmpRoot, 'session-2'))).resolves.toBeDefined()
  })
})
