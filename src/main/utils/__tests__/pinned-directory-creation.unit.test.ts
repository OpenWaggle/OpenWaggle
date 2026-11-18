import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureDirectoryPathPinned } from '../pinned-directory-creation'

describe('pinned directory creation', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-pinned-directory-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('never creates through an ancestor swapped after helper validation', async () => {
    const authorized = path.join(root, 'authorized')
    const moved = path.join(root, 'authorized-moved')
    const outside = path.join(root, 'outside')
    await Promise.all([fs.mkdir(authorized), fs.mkdir(outside)])

    await expect(
      ensureDirectoryPathPinned({
        targetDirectory: path.join(authorized, 'first', 'second'),
        mode: 0o700,
        beforeMutation: async () => {
          await fs.rename(authorized, moved)
          await fs.symlink(outside, authorized)
        },
      }),
    ).rejects.toThrow()

    await expect(fs.stat(path.join(outside, 'first'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(path.join(moved, 'first'))).resolves.toMatchObject({})
  })
})
