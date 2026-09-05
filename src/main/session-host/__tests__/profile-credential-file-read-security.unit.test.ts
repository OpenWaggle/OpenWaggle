import { spawnSync } from 'node:child_process'
import { constants as FS_CONSTANTS } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

import { generateProfileCredential } from '../profile-credential'
import {
  PROFILE_CREDENTIAL_FILE_MAX_BYTES,
  readProfileCredentialFile,
} from '../profile-credential-storage'

const itPosix = process.platform === 'win32' ? it.skip : it

describe('profile credential file reads', () => {
  let root = ''

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-profile-credential-read-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('reads a bounded regular credential file', async () => {
    const credential = generateProfileCredential()
    const credentialPath = path.join(root, 'profile.secret')
    await fs.writeFile(credentialPath, `${credential}\n`, { mode: 0o600 })

    await expect(readProfileCredentialFile(credentialPath)).resolves.toBe(credential)
  })

  itPosix('rejects a symbolic link instead of following it', async () => {
    const credential = generateProfileCredential()
    const credentialPath = path.join(root, 'profile.secret')
    const linkPath = path.join(root, 'profile-link.secret')
    await fs.writeFile(credentialPath, `${credential}\n`, { mode: 0o600 })
    await fs.symlink(credentialPath, linkPath)

    await expect(readProfileCredentialFile(linkPath)).rejects.toThrow('regular file')
  })

  itPosix(
    'rejects a FIFO without waiting for a producer',
    async () => {
      const fifoPath = path.join(root, 'profile.fifo')
      expect(spawnSync('mkfifo', [fifoPath]).status).toBe(0)

      const reading = readProfileCredentialFile(fifoPath)
      let rescueWriter: Awaited<ReturnType<typeof fs.open>> | undefined
      const outcome = await Promise.race([
        reading.then(
          () => 'read' as const,
          () => 'rejected' as const,
        ),
        new Promise<'stalled'>((resolve) => {
          setTimeout(() => resolve('stalled'), 500).unref()
        }),
      ])
      if (outcome === 'stalled') {
        rescueWriter = await fs.open(fifoPath, FS_CONSTANTS.O_RDWR | (FS_CONSTANTS.O_NONBLOCK ?? 0))
      }
      try {
        expect(outcome).toBe('rejected')
        await expect(reading).rejects.toThrow('regular file')
      } finally {
        await rescueWriter?.close()
      }
    },
    2_000,
  )

  it('rejects an oversized credential file before validation', async () => {
    const credentialPath = path.join(root, 'oversized.secret')
    await fs.writeFile(credentialPath, Buffer.alloc(PROFILE_CREDENTIAL_FILE_MAX_BYTES + 1, 0x61))

    await expect(readProfileCredentialFile(credentialPath)).rejects.toThrow('1 KiB size limit')
  })
})
