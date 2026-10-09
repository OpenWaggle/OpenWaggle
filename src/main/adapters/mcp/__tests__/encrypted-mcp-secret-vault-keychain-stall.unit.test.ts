import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEncryptedMcpSecretVault } from '../encrypted-mcp-secret-vault-service'
import { MCP_KEYCHAIN_TIMEOUT_MS } from '../mcp-vault-encryption'

function never<T>() {
  return new Promise<T>(() => {})
}

/** A keychain that never answers: no login keychain, or a prompt nobody answers. */
function stalledKeychain() {
  const calls = vi.fn()
  return {
    calls,
    encryption: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString(),
      isAsyncEncryptionAvailable: () => {
        calls('isAsyncEncryptionAvailable')
        return never<boolean>()
      },
      encryptStringAsync: () => {
        calls('encryptStringAsync')
        return never<Buffer>()
      },
      decryptStringAsync: () => {
        calls('decryptStringAsync')
        return never<{ result: string }>()
      },
    },
  }
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'ow-mcp-vault-stall-'))
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(root, { recursive: true, force: true })
})

describe('the MCP secret vault with a keychain that does not answer', () => {
  it('reports a missing secret without asking the keychain', async () => {
    const keychain = stalledKeychain()
    const vault = createEncryptedMcpSecretVault(path.join(root, 'vault.json'), keychain.encryption)

    await expect(vault.resolve('ABSENT')).rejects.toMatchObject({ reason: 'secret-not-found' })
    expect(keychain.calls).not.toHaveBeenCalled()
  })

  it('fails a save that waits for the keychain, instead of hanging', async () => {
    vi.useFakeTimers()
    const keychain = stalledKeychain()
    const vault = createEncryptedMcpSecretVault(path.join(root, 'vault.json'), keychain.encryption)

    const saving = vault.set('TOKEN', 'value')
    const failure = expect(saving).rejects.toThrow('The system keychain did not answer')
    await vi.advanceTimersByTimeAsync(MCP_KEYCHAIN_TIMEOUT_MS)

    await failure
  })
})
