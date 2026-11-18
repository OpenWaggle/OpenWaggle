import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionResourceStore } from '../../ports/session-resource-store'
import { makeFilesystemSessionResourceStoreLayer } from '../filesystem-session-resource-store'

let tmpRoot = ''

describe('FilesystemSessionResourceStore streaming', () => {
  beforeEach(async () => {
    tmpRoot = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-resource-stream-')),
    )
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('opens managed content as a stream without buffering the file in application state', async () => {
    const bytes = new TextEncoder().encode('streamed image bytes')
    const stream = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* SessionResourceStore
        const stored = yield* store.storeBytes({
          sessionId: SessionId('session-1'),
          resourceId: 'resource-1',
          fileName: 'image.png',
          bytes,
        })
        return yield* store.openReadStream(stored.path)
      }).pipe(Effect.provide(makeFilesystemSessionResourceStoreLayer(tmpRoot))),
    )

    await expect(new Response(stream).text()).resolves.toBe('streamed image bytes')
  })
})
