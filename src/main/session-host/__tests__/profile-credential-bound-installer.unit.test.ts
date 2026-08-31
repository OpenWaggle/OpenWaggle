import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installCredentialInBoundDirectory } from '../profile-credential-bound-installer'

describe('profile credential bound installer', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-credential-install-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('rejects a destination directory replaced before the helper pins it', async () => {
    const directory = path.join(root, 'credentials')
    const moved = path.join(root, 'credentials-authorized')
    const sourcePath = path.join(root, 'credential.source')
    await Promise.all([fs.mkdir(directory), fs.writeFile(sourcePath, 'secret')])
    const stats = await fs.stat(directory)
    const sourceHandle = await fs.open(sourcePath, 'r')
    try {
      await expect(
        installCredentialInBoundDirectory({
          directory,
          directoryIdentity: `${stats.dev}:${stats.ino}`,
          targetName: 'profile.credential',
          mode: 'create',
          sourceHandle,
          beforeSpawn: async () => {
            await fs.rename(directory, moved)
            await fs.symlink(moved, directory)
          },
        }),
      ).rejects.toThrow()
    } finally {
      await sourceHandle.close()
    }
    await expect(fs.readdir(moved)).resolves.toEqual([])
  })
})
