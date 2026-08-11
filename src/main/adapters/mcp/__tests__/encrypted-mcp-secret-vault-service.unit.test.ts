import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createEncryptedMcpSecretVault } from '../encrypted-mcp-secret-vault-service'

const roots: string[] = []

async function fixture(available = true) {
  const root = await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-vault-'))
  roots.push(root)
  const filePath = path.join(root, 'vault.json')
  const encryption = {
    isEncryptionAvailable: () => available,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').replace(/^encrypted:/, ''),
  }
  const vault = createEncryptedMcpSecretVault(filePath, encryption)
  return {
    filePath,
    vault,
    createPeerVault: () => createEncryptedMcpSecretVault(filePath, encryption),
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('encrypted MCP secret vault', () => {
  it('never persists or lists plaintext values', async () => {
    const { filePath, vault } = await fixture()

    const summaries = await vault.set('docs-token', 'super-secret-value')
    const raw = await readFile(filePath, 'utf8')

    expect(summaries).toEqual([
      expect.objectContaining({ name: 'docs-token', createdAt: expect.any(Number) }),
    ])
    expect(summaries[0]).not.toHaveProperty('value')
    expect(raw).not.toContain('super-secret-value')
    expect(await vault.resolve('docs-token')).toBe('super-secret-value')
  })

  it('preserves creation time when rotating a secret and supports removal', async () => {
    const { vault } = await fixture()
    const [created] = await vault.set('docs-token', 'first')
    const [rotated] = await vault.set('docs-token', 'second')

    expect(rotated?.createdAt).toBe(created?.createdAt)
    expect(await vault.resolve('docs-token')).toBe('second')
    expect(await vault.remove('docs-token')).toEqual([])
    await expect(vault.resolve('docs-token')).rejects.toThrow('was not found')
  })

  it('serializes concurrent read-modify-write operations without losing secrets', async () => {
    const { vault, createPeerVault } = await fixture()
    const peerVault = createPeerVault()

    await Promise.all([
      vault.set('first-token', 'first'),
      peerVault.set('second-token', 'second'),
      createPeerVault().set('third-token', 'third'),
    ])

    await expect(vault.list()).resolves.toEqual([
      expect.objectContaining({ name: 'first-token' }),
      expect.objectContaining({ name: 'second-token' }),
      expect.objectContaining({ name: 'third-token' }),
    ])
  })

  it('fails closed when operating-system encryption is unavailable', async () => {
    const { vault } = await fixture(false)

    await expect(vault.set('docs-token', 'value')).rejects.toThrow(
      'Operating-system encryption is unavailable',
    )
  })
})
