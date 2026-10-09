import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Effect } from 'effect'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const paths = vi.hoisted(() => ({ root: '' }))

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^sealed:/, ''),
  },
}))
vi.mock('../credentials/mcp-build-state-paths', () => ({
  mcpBuildStateDirectory: () => path.join(paths.root, 'build'),
  sharedMcpStateDirectory: () => path.join(paths.root, 'shared'),
}))

paths.root = mkdtempSync(path.join(tmpdir(), 'ow-mcp-vault-stamps-'))
const { EncryptedMcpSecretVaultServiceLive, mcpVaultSecretStamps } = await import(
  '../encrypted-mcp-secret-vault-service'
)
const { McpSecretVaultService } = await import('../../../ports/mcp-secret-vault-service')

const buildVault = () => path.join(paths.root, 'build', 'vault.json')
const sharedVault = () => path.join(paths.root, 'shared', 'vault.json')

function writeVault(filePath: string, secrets: Record<string, number>) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  const entries = Object.entries(secrets).map(([name, updatedAt]) => [
    name,
    { encryptedValue: Buffer.from(`sealed:${name}`).toString('base64'), createdAt: 1, updatedAt },
  ])
  writeFileSync(filePath, JSON.stringify({ version: 1, secrets: Object.fromEntries(entries) }))
}

function save(name: string, value: string) {
  return Effect.runPromise(
    Effect.flatMap(McpSecretVaultService, (vault) => vault.set({ name, value })).pipe(
      Effect.provide(EncryptedMcpSecretVaultServiceLive),
    ),
  )
}

beforeEach(() => {
  rmSync(path.join(paths.root, 'build'), { recursive: true, force: true })
  rmSync(path.join(paths.root, 'shared'), { recursive: true, force: true })
})

afterAll(() => {
  rmSync(paths.root, { recursive: true, force: true })
})

describe("a vault secret's stamp, which names the connections that read it", () => {
  it('is the same after the takeover save of another secret', async () => {
    writeVault(sharedVault(), { OLD: 5 })
    const before = await mcpVaultSecretStamps()('OLD')

    await save('NEW', 'value')

    expect(before).toBe('OLD@5')
    await expect(mcpVaultSecretStamps()('OLD')).resolves.toBe(before)
  })

  it('changes when the same secret is saved again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000)
    await save('TOKEN', 'first')
    const first = await mcpVaultSecretStamps()('TOKEN')
    vi.setSystemTime(2_000)
    await save('TOKEN', 'second')
    vi.useRealTimers()

    await expect(mcpVaultSecretStamps()('TOKEN')).resolves.not.toBe(first)
  })

  it('lists the vault once per load', async () => {
    writeVault(buildVault(), { A: 1, B: 2 })
    const stamp = mcpVaultSecretStamps()
    await expect(stamp('A')).resolves.toBe('A@1')

    // Saved since: the same load keeps what it listed first.
    writeVault(buildVault(), { A: 9, B: 9 })
    await expect(stamp('B')).resolves.toBe('B@2')
    await expect(mcpVaultSecretStamps()('B')).resolves.toBe('B@9')
  })

  it('falls back to the name when the vault cannot be listed', async () => {
    mkdirSync(path.dirname(buildVault()), { recursive: true })
    writeFileSync(buildVault(), '{ not json')

    await expect(mcpVaultSecretStamps()('TOKEN')).resolves.toBe('TOKEN@')
  })
})
