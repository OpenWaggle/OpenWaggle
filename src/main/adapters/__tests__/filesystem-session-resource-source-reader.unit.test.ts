import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readBoundedSessionResourceSource } from '../filesystem-session-resource-source-reader'

let tmpRoot = ''

describe('readBoundedSessionResourceSource', () => {
  beforeEach(async () => {
    tmpRoot = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-resource-source-')),
    )
  })

  afterEach(async () => {
    if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('reads bounded files only from authorized roots', async () => {
    const allowedRoot = path.join(tmpRoot, 'allowed')
    const outsideRoot = path.join(tmpRoot, 'outside')
    const sourcePath = path.join(allowedRoot, 'image.png')
    const outsidePath = path.join(outsideRoot, 'private.png')
    await fs.mkdir(allowedRoot)
    await fs.mkdir(outsideRoot)
    await fs.writeFile(sourcePath, Buffer.from([1, 2, 3]))
    await fs.writeFile(outsidePath, Buffer.from([4, 5, 6]))

    await expect(
      readBoundedSessionResourceSource({
        sourcePath,
        allowedRoots: [allowedRoot],
        maxSizeBytes: 3,
      }),
    ).resolves.toEqual(Buffer.from([1, 2, 3]))
    await expect(
      readBoundedSessionResourceSource({
        sourcePath: outsidePath,
        allowedRoots: [allowedRoot],
        maxSizeBytes: 3,
      }),
    ).rejects.toThrow('outside the authorized roots')
    await expect(
      readBoundedSessionResourceSource({
        sourcePath,
        allowedRoots: [allowedRoot],
        maxSizeBytes: 2,
      }),
    ).rejects.toThrow('not a bounded regular file')
  })
})
