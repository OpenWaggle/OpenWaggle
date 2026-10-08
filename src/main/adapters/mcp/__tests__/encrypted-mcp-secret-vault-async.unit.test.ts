import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEncryptedMcpSecretVault } from '../encrypted-mcp-secret-vault-service'

/**
 * Electron's safeStorage, where every synchronous call is the main-thread keychain read that can
 * stall for minutes: reading the vault must only use the asynchronous API. Electron 43's
 * `decryptStringAsync` opens values `encryptString` sealed (same `v10` format).
 */
const keychainOffMainThread = {
  isEncryptionAvailable: () => {
    throw new Error('synchronous keychain call')
  },
  encryptString: (_value: string) => {
    throw new Error('synchronous keychain call')
  },
  decryptString: (_value: Buffer) => {
    throw new Error('synchronous keychain call')
  },
  isAsyncEncryptionAvailable: async () => true,
  encryptStringAsync: async (value: string) => Buffer.from(`sealed:${value}`),
  decryptStringAsync: async (value: Buffer) => {
    const text = value.toString()
    if (!text.startsWith('sealed:')) throw new Error('Error while decrypting the ciphertext.')
    return { result: text.slice('sealed:'.length), shouldReEncrypt: false }
  },
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ow-mcp-vault-async-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('the MCP secret vault without the synchronous keychain API', () => {
  it('stores and reads secrets', async () => {
    const vault = createEncryptedMcpSecretVault(
      path.join(root, 'vault.json'),
      keychainOffMainThread,
    )

    await vault.set('TOKEN', 'value')

    await expect(vault.resolve('TOKEN')).resolves.toBe('value')
  })

  it("takes over the shared vault's secrets this build opens", async () => {
    const legacyFilePath = path.join(root, 'shared', 'vault.json')
    await mkdir(path.dirname(legacyFilePath), { recursive: true })
    const entry = (sealed: string) => ({
      encryptedValue: Buffer.from(sealed).toString('base64'),
      createdAt: 1,
      updatedAt: 1,
    })
    await writeFile(
      legacyFilePath,
      JSON.stringify({
        version: 1,
        secrets: { mine: entry('sealed:old'), theirs: entry('other-key:x') },
      }),
    )
    const vault = createEncryptedMcpSecretVault(
      path.join(root, 'build', 'vault.json'),
      keychainOffMainThread,
      { legacyFilePath },
    )

    await expect(vault.resolve('mine')).resolves.toBe('old')
    await vault.remove('unrelated')
    await expect(vault.list()).resolves.toEqual([expect.objectContaining({ name: 'mine' })])
  })

  it('tells whether a secret exists without reading the keychain', async () => {
    const filePath = path.join(root, 'vault.json')
    await createEncryptedMcpSecretVault(filePath, keychainOffMainThread).set('TOKEN', 'value')
    const unreadable = {
      ...keychainOffMainThread,
      isAsyncEncryptionAvailable: async () => {
        throw new Error('keychain read')
      },
      decryptStringAsync: async () => {
        throw new Error('keychain read')
      },
    }
    const vault = createEncryptedMcpSecretVault(filePath, unreadable)

    await expect(vault.has('TOKEN')).resolves.toBe(true)
    await expect(vault.has('OTHER')).resolves.toBe(false)
  })
})
