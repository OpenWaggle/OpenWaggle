import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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

/** A keychain that seals and opens values, but whose decryption never answers. */
function keychainThatDoesNotDecrypt() {
  const sealed = (value: string) => Buffer.from(`sealed:${value}`)
  return {
    sealed,
    encryption: {
      isEncryptionAvailable: () => true,
      encryptString: sealed,
      decryptString: (value: Buffer) => value.toString().replace('sealed:', ''),
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async (value: string) => sealed(value),
      decryptStringAsync: () => never<{ result: string }>(),
    },
  }
}

const TIMER_STEP_MS = 1_000
const MAX_TIMER_STEPS = 500

/** Advances the fake clock while `promise` also waits on real file I/O. */
async function settleWithTimers(promise: Promise<unknown>) {
  let settled = false
  void promise.then(
    () => (settled = true),
    () => (settled = true),
  )
  // Steps are bounded, not the fake time: a step may pass while the file I/O is still going.
  for (let step = 0; !settled && step < MAX_TIMER_STEPS; step += 1) {
    await new Promise((resolve) => setImmediate(resolve))
    await vi.advanceTimersByTimeAsync(TIMER_STEP_MS)
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

  describe('when only decryption does not answer', () => {
    async function sharedVaultWithMine(sealed: (value: string) => Buffer) {
      const legacyFilePath = path.join(root, 'shared-vault.json')
      const entry = {
        encryptedValue: sealed('mine').toString('base64'),
        createdAt: 1,
        updatedAt: 1,
      }
      await writeFile(legacyFilePath, JSON.stringify({ version: 1, secrets: { MINE: entry } }))
      return legacyFilePath
    }

    it('reports the timeout, not a secret of another build', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const keychain = keychainThatDoesNotDecrypt()
      const legacyFilePath = await sharedVaultWithMine(keychain.sealed)
      const vault = createEncryptedMcpSecretVault(
        path.join(root, 'own.json'),
        keychain.encryption,
        {
          legacyFilePath,
        },
      )

      const resolving = vault.resolve('MINE')
      const failure = expect(resolving).rejects.toMatchObject({
        reason: 'encryption-unavailable',
        message: expect.stringContaining('The system keychain did not answer'),
      })
      await settleWithTimers(resolving)

      await failure
    })

    it("fails the first save instead of dropping this build's own secrets", async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const keychain = keychainThatDoesNotDecrypt()
      const legacyFilePath = await sharedVaultWithMine(keychain.sealed)
      const ownFilePath = path.join(root, 'own.json')
      const vault = createEncryptedMcpSecretVault(ownFilePath, keychain.encryption, {
        legacyFilePath,
      })

      const saving = vault.set('NEW', 'value')
      const failure = expect(saving).rejects.toMatchObject({ reason: 'encryption-unavailable' })
      await settleWithTimers(saving)

      await failure
      // No takeover is recorded, so a later save, once the keychain answers, still copies MINE.
      await expect(readFile(ownFilePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(vault.list()).resolves.toEqual([expect.objectContaining({ name: 'MINE' })])
    })
  })
})
