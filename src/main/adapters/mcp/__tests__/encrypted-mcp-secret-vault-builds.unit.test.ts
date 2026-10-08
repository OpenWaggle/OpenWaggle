import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createEncryptedMcpSecretVault,
  sharedMcpVaultHasSecret,
} from '../encrypted-mcp-secret-vault-service'

function keyed(key: string) {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`${key}:${value}`),
    decryptString: (value: Buffer) => {
      const text = value.toString()
      if (!text.startsWith(`${key}:`)) throw new Error('Error while decrypting the ciphertext.')
      return text.slice(key.length + 1)
    },
  }
}

const RELEASE = keyed('release')
const DEV = keyed('dev')

let root: string
let legacyPath: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ow-mcp-vault-builds-'))
  legacyPath = path.join(root, 'home', '.openwaggle', 'mcp', 'vault.json')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function vaultFor(build: string, encryption: typeof RELEASE) {
  return createEncryptedMcpSecretVault(path.join(root, build, 'mcp', 'vault.json'), encryption, {
    legacyFilePath: legacyPath,
  })
}

async function writeLegacy(entries: Record<string, string>) {
  const secrets = Object.fromEntries(
    Object.entries(entries).map(([name, sealed]) => [
      name,
      { encryptedValue: Buffer.from(sealed).toString('base64'), createdAt: 1, updatedAt: 2 },
    ]),
  )
  await mkdir(path.dirname(legacyPath), { recursive: true })
  await writeFile(legacyPath, JSON.stringify({ version: 1, secrets }))
}

describe('the MCP secret vault per build', () => {
  it('keeps each build’s secrets apart', async () => {
    await vaultFor('release', RELEASE).set('TOKEN', 'release-value')
    await vaultFor('dev', DEV).set('TOKEN', 'dev-value')

    await expect(vaultFor('release', RELEASE).resolve('TOKEN')).resolves.toBe('release-value')
    await expect(vaultFor('dev', DEV).resolve('TOKEN')).resolves.toBe('dev-value')
  })

  it('takes over the secrets of the shared vault this build can decrypt, on its first save', async () => {
    await writeLegacy({ TOKEN: 'release:old-value', OTHER: 'dev:dev-only' })
    const before = await readFile(legacyPath, 'utf8')

    const release = vaultFor('release', RELEASE)
    await expect(release.resolve('TOKEN')).resolves.toBe('old-value')
    // Until then the shared names are listed, read without decrypting.
    expect((await release.list()).map((secret) => secret.name)).toEqual(['OTHER', 'TOKEN'])
    await release.set('NEW', 'new-value')
    expect((await release.list()).map((secret) => secret.name)).toEqual(['NEW', 'TOKEN'])
    await expect(vaultFor('dev', DEV).resolve('OTHER')).resolves.toBe('dev-only')
    // The shared vault is left for every build.
    expect(await readFile(legacyPath, 'utf8')).toBe(before)
  })

  it('tells whether the shared vault holds a secret, whichever build sealed it', async () => {
    const shared = path.join(homedir(), '.openwaggle', 'mcp', 'vault.json')
    await mkdir(path.dirname(shared), { recursive: true })
    await writeFile(
      shared,
      JSON.stringify({
        version: 1,
        secrets: { 'oauth.a': { encryptedValue: 'eA==', createdAt: 1, updatedAt: 1 } },
      }),
    )

    await expect(sharedMcpVaultHasSecret('oauth.a')).resolves.toBe(true)
    await expect(sharedMcpVaultHasSecret('oauth.b')).resolves.toBe(false)
    await rm(shared, { force: true })
  })
})
