import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionResourceStore } from '../../ports/session-resource-store'
import { makeFilesystemSessionResourceStoreLayer } from '../filesystem-session-resource-store'

let tmpRoot = ''

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
})
