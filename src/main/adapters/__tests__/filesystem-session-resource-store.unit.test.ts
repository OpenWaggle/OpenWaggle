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
