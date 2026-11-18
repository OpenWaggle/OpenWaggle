import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEncryptedMcpSecretVault } from '../encrypted-mcp-secret-vault-service'

/** This build's key opens `release:` values; every keychain read is counted. */
function releaseKey() {
  const state = { available: true, refuse: false }
  const decryptStringAsync = vi.fn(async (value: Buffer) => {
    const text = value.toString()
    if (state.refuse || !text.startsWith('release:')) {
      throw new Error('Error while decrypting the ciphertext.')
    }
    return { result: text.slice('release:'.length), shouldReEncrypt: false }
  })
  return {
    state,
    decryptStringAsync,
    encryption: {
      isEncryptionAvailable: () => state.available,
      encryptString: (value: string) => Buffer.from(`release:${value}`),
      decryptString: (value: Buffer) => value.toString().replace(/^release:/, ''),
      isAsyncEncryptionAvailable: async () => state.available,
      encryptStringAsync: async (value: string) => Buffer.from(`release:${value}`),
      decryptStringAsync,
    },
  }
}

let root: string
let legacyFilePath: string
let filePath: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ow-mcp-vault-takeover-'))
  legacyFilePath = path.join(root, 'shared', 'vault.json')
  filePath = path.join(root, 'build', 'vault.json')
  const entry = (sealed: string) => ({
    encryptedValue: Buffer.from(sealed).toString('base64'),
    createdAt: 1,
    updatedAt: 1,
  })
  await mkdir(path.dirname(legacyFilePath), { recursive: true })
  await writeFile(
    legacyFilePath,
    JSON.stringify({
      version: 1,
      secrets: { OLD: entry('release:old'), THEIRS: entry('dev:theirs') },
    }),
  )
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function names(summaries: readonly { readonly name: string }[]) {
  return summaries.map((summary) => summary.name)
}

describe("taking over the shared vault's secrets", () => {
  it('lists and finds them without reading the keychain', async () => {
    const key = releaseKey()
    const vault = createEncryptedMcpSecretVault(filePath, key.encryption, { legacyFilePath })

    // Two reads at once both see the shared vault.
    const [first, second] = await Promise.all([vault.list(), vault.list()])
    await expect(vault.has('OLD')).resolves.toBe(true)

    expect(names(first)).toEqual(['OLD', 'THEIRS'])
    expect(names(second)).toEqual(['OLD', 'THEIRS'])
    expect(key.decryptStringAsync).not.toHaveBeenCalled()
  })

  it('keeps an old secret when a new one is saved while it is read', async () => {
    const key = releaseKey()
    const vault = createEncryptedMcpSecretVault(filePath, key.encryption, { legacyFilePath })

    const [resolved] = await Promise.all([vault.resolve('OLD'), vault.set('NEW', 'new')])

    expect(resolved).toBe('old')
    // The first save took over what this build's key opens; another build's secret stays theirs.
    expect(names(await vault.list())).toEqual(['NEW', 'OLD'])
    await expect(vault.resolve('OLD')).resolves.toBe('old')
    await expect(vault.resolve('THEIRS')).rejects.toThrow('was not found')
  })

  it('tries again after a takeover that could not finish', async () => {
    const key = releaseKey()
    const vault = createEncryptedMcpSecretVault(filePath, key.encryption, { legacyFilePath })

    key.state.available = false
    await expect(vault.resolve('OLD')).rejects.toThrow('encryption is unavailable')
    key.state.available = true
    key.state.refuse = true
    await expect(vault.resolve('OLD')).rejects.toThrow()
    key.state.refuse = false

    await expect(vault.resolve('OLD')).resolves.toBe('old')
    await vault.set('NEW', 'new')
    await expect(vault.resolve('OLD')).resolves.toBe('old')
  })

  it('reports an old secret this build cannot open as not found, as another build owns it', async () => {
    const key = releaseKey()
    const vault = createEncryptedMcpSecretVault(filePath, key.encryption, { legacyFilePath })

    // Still not found for the migration's rules, and named as another build's for the user.
    await expect(vault.resolve('THEIRS')).rejects.toMatchObject({
      reason: 'secret-not-found',
      message:
        'MCP secret "THEIRS" was saved by another OpenWaggle build, which this one cannot read. Save it again under Settings > MCP > Secrets.',
    })
  })
})
