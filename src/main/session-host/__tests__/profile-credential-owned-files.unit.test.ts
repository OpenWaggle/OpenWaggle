import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readOwnedFile, unlinkOwnedFile } from '../profile-credential-owned-files'

describe('profile credential owned files', () => {
  let directory = ''

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-owned-files-'))
  })

  afterEach(async () => {
    await fs.rm(directory, { recursive: true, force: true })
  })

  it('does not follow a basename replaced by a symlink after validation', async () => {
    const name = 'pending.secret'
    const outside = path.join(directory, 'outside.secret')
    await Promise.all([
      fs.writeFile(path.join(directory, name), 'protected'),
      fs.writeFile(outside, 'outside secret'),
    ])

    await expect(
      readOwnedFile(directory, name, async () => {
        await fs.unlink(path.join(directory, name))
        await fs.symlink(outside, path.join(directory, name))
      }),
    ).rejects.toThrow()
  })

  it('preserves a replacement when identity-bound cleanup loses its claim', async () => {
    const name = 'pending.secret'
    await fs.writeFile(path.join(directory, name), 'protected')
    const original = await readOwnedFile(directory, name)
    if (!original.fileIdentity) throw new Error('Expected a test file identity.')

    await expect(
      unlinkOwnedFile(directory, name, original.fileIdentity, async () => {
        await fs.unlink(path.join(directory, name))
        await fs.writeFile(path.join(directory, name), 'replacement')
      }),
    ).rejects.toThrow('recoverable')
    await expect(fs.readFile(path.join(directory, name), 'utf8')).resolves.toBe('replacement')
  })

  it('rejects an owned directory replaced before the helper pins it', async () => {
    const owned = path.join(directory, 'owned')
    const moved = path.join(directory, 'owned-authorized')
    await fs.mkdir(owned)
    await fs.writeFile(path.join(owned, 'pending.secret'), 'protected')

    await expect(
      readOwnedFile(owned, 'pending.secret', undefined, async () => {
        await fs.rename(owned, moved)
        await fs.symlink(moved, owned)
      }),
    ).rejects.toThrow()
    await expect(fs.readdir(moved)).resolves.toEqual(['pending.secret'])
  })
})
