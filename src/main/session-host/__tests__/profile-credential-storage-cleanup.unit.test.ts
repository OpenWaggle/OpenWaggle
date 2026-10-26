import { createHash } from 'node:crypto'
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

const {
  readStoredProfileCredential,
  removeStoredProfileCredential,
  removeStoredProfileCredentialCopy,
  storedProfileCredentialPath,
} = await import('../profile-credential-storage')

const identity = createHash('sha256').update('helper').digest('hex')
const otherIdentity = createHash('sha256').update('other').digest('hex')

describe('stored profile credentials (#351)', () => {
  let stateRoot = ''

  beforeEach(async () => {
    stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-profile-storage-'))
    await fs.mkdir(path.join(stateRoot, 'profile-credentials'))
    await fs.mkdir(path.join(stateRoot, 'profile-credential-staging'))
    await fs.mkdir(path.join(stateRoot, 'profile-credential-receipts'))
  })

  afterEach(async () => {
    await fs.rm(stateRoot, { recursive: true, force: true })
  })

  function staged(name: string) {
    return path.join(stateRoot, 'profile-credential-staging', name)
  }

  it('says which profile has no stored credential instead of naming a hashed path', async () => {
    await expect(
      readStoredProfileCredential({ stateRoot, profileName: 'helper' }),
    ).rejects.toMatchObject({
      kind: 'authentication',
      message: expect.stringContaining('No stored credential for access profile "helper".'),
    })
    const error = await readStoredProfileCredential({ stateRoot, profileName: 'helper' }).catch(
      (cause: unknown) => cause,
    )
    expect(error instanceof Error ? error.message : '').not.toContain(identity)
  })

  it('removes a revoked profile’s credential and consumed markers, keeping pending recovery files', async () => {
    await fs.writeFile(storedProfileCredentialPath(stateRoot, 'helper'), 'secret')
    await fs.writeFile(staged(`${identity}.dest.marker-1.consumed`), 'foreign-ineligible\n')
    await fs.writeFile(staged(`${identity}.dest.marker-2.consumed`), 'foreign-ineligible\n')
    await fs.writeFile(staged(`${identity}.dest.key.pending`), 'pending')
    await fs.writeFile(staged(`${otherIdentity}.dest.marker.consumed`), 'foreign-ineligible\n')

    await removeStoredProfileCredential({ stateRoot, profileName: 'helper' })

    expect((await fs.readdir(path.join(stateRoot, 'profile-credential-staging'))).sort()).toEqual(
      [`${identity}.dest.key.pending`, `${otherIdentity}.dest.marker.consumed`].sort(),
    )
    await expect(fs.access(storedProfileCredentialPath(stateRoot, 'helper'))).rejects.toThrow()
  })

  it('removes only the stored copy after the credential moved to a file', async () => {
    await fs.writeFile(storedProfileCredentialPath(stateRoot, 'helper'), 'stale')
    await fs.writeFile(path.join(stateRoot, 'profile-credential-receipts', `${identity}.r`), 'r')

    await removeStoredProfileCredentialCopy({ stateRoot, profileName: 'helper' })
    await removeStoredProfileCredentialCopy({ stateRoot, profileName: 'helper' })

    await expect(fs.access(storedProfileCredentialPath(stateRoot, 'helper'))).rejects.toThrow()
    expect(await fs.readdir(path.join(stateRoot, 'profile-credential-receipts'))).toEqual([
      `${identity}.r`,
    ])
  })
})
