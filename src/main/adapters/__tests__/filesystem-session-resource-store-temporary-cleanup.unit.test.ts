import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionResourceStore } from '../../ports/session-resource-store'
import { makeFilesystemSessionResourceStoreLayer } from '../filesystem-session-resource-store'

const temporaryDirectories: string[] = []

describe('FilesystemSessionResourceStore temporary cleanup', () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => fs.rm(directory, { recursive: true, force: true })),
    )
  })

  it('sweeps legacy random temporary files while preserving unrelated entries', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-resource-cleanup-'))
    temporaryDirectories.push(root)
    const sessionId = SessionId('session-1')
    const sessionDirectory = path.join(
      root,
      createHash('sha256').update(String(sessionId)).digest('hex'),
    )
    const legacyTemporary = path.join(sessionDirectory, '.123e4567-e89b-42d3-a456-426614174000.tmp')
    const unrelated = path.join(sessionDirectory, '.keep-me.tmp')
    await fs.mkdir(sessionDirectory, { recursive: true })
    await fs.writeFile(legacyTemporary, 'interrupted write')
    await fs.writeFile(unrelated, 'user file')

    const stored = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* SessionResourceStore
        return yield* store.storeBytes({
          sessionId,
          resourceId: 'resource-1',
          fileName: 'image.png',
          bytes: new Uint8Array([1, 2, 3]),
        })
      }).pipe(Effect.provide(makeFilesystemSessionResourceStoreLayer(root))),
    )

    await expect(fs.stat(legacyTemporary)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.readFile(unrelated, 'utf8')).resolves.toBe('user file')
    await expect(fs.stat(`${stored.path}.tmp`)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
