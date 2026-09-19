import type * as FsPromises from 'node:fs/promises'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const filesystem = vi.hoisted(() => ({
  unlink: vi.fn<(filePath: string) => Promise<void>>(),
  readdir: vi.fn<(directory: string) => Promise<string[]>>(),
}))

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof FsPromises>()),
  unlink: filesystem.unlink,
  readdir: filesystem.readdir,
}))
vi.mock('electron', () => ({ safeStorage: {} }))

import {
  removeStoredProfileCredential,
  storedProfileCredentialPath,
} from '../profile-credential-storage'

const input = { stateRoot: '/state', profileName: 'worker' }
const credentialPath = storedProfileCredentialPath(input.stateRoot, input.profileName)
const receipt = `${path.basename(credentialPath, '.credential')}.operation.receipt`
const receiptPath = path.join(input.stateRoot, 'profile-credential-receipts', receipt)

describe('stored profile credential cleanup', () => {
  beforeEach(() => {
    filesystem.unlink.mockReset().mockResolvedValue(undefined)
    filesystem.readdir.mockReset().mockResolvedValue([])
  })

  it('reports a permission failure deleting the encrypted credential', async () => {
    const failure = Object.assign(new Error(`EACCES: unlink ${credentialPath}`), {
      code: 'EACCES',
      path: credentialPath,
    })
    filesystem.unlink.mockRejectedValue(failure)

    await expect(removeStoredProfileCredential(input)).rejects.toBe(failure)
  })

  it('reports a failure reading the credential receipt directory', async () => {
    const failure = Object.assign(new Error('EPERM: receipt directory is inaccessible'), {
      code: 'EPERM',
    })
    filesystem.readdir.mockRejectedValue(failure)

    await expect(removeStoredProfileCredential(input)).rejects.toBe(failure)
  })

  it('reports a locked credential receipt rather than reporting successful cleanup', async () => {
    const failure = Object.assign(new Error(`EBUSY: unlink ${receiptPath}`), { code: 'EBUSY' })
    filesystem.readdir.mockResolvedValue([receipt])
    filesystem.unlink.mockImplementation(async (filePath) => {
      if (filePath === receiptPath) throw failure
    })

    await expect(removeStoredProfileCredential(input)).rejects.toBe(failure)
  })

  it('treats an absent credential and receipt directory as already cleaned up', async () => {
    const missing = Object.assign(new Error('No such file'), { code: 'ENOENT' })
    filesystem.unlink.mockRejectedValue(missing)
    filesystem.readdir.mockRejectedValue(missing)

    await expect(removeStoredProfileCredential(input)).resolves.toBeUndefined()
  })

  it('tolerates a receipt removed concurrently and leaves unrelated profiles alone', async () => {
    filesystem.readdir.mockResolvedValue([receipt, 'another-profile.operation.receipt'])
    filesystem.unlink.mockImplementation(async (filePath) => {
      if (filePath === receiptPath) {
        throw Object.assign(new Error('Receipt already removed'), { code: 'ENOENT' })
      }
    })

    await expect(removeStoredProfileCredential(input)).resolves.toBeUndefined()
    expect(filesystem.unlink.mock.calls).toEqual([[credentialPath], [receiptPath]])
  })

  it('removes the stored credential and each matching receipt', async () => {
    filesystem.readdir.mockResolvedValue([receipt, 'another-profile.operation.receipt'])

    await expect(removeStoredProfileCredential(input)).resolves.toBeUndefined()
    expect(filesystem.unlink.mock.calls).toEqual([[credentialPath], [receiptPath]])
  })
})
