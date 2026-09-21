import { describe, expect, it, vi } from 'vitest'
import { createMcpOAuthVaultAuthority } from '../oauth-vault-authority'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('MCP OAuth vault authority', () => {
  it('serializes logout after an in-flight refresh and leaves credentials revoked', async () => {
    const values = new Map<string, string>([['oauth', 'old-token']])
    const refreshStarted = deferred()
    const allowRefreshCommit = deferred()
    const vault = {
      resolve: vi.fn(async (name: string) => {
        const value = values.get(name)
        if (value === undefined) throw new Error(`${name} was not found`)
        return value
      }),
      set: vi.fn(async (name: string, value: string) => {
        refreshStarted.resolve()
        await allowRefreshCommit.promise
        values.set(name, value)
      }),
      remove: vi.fn(async (name: string) => {
        values.delete(name)
      }),
    }
    const authority = createMcpOAuthVaultAuthority()
    const runtimeVault = authority.runtimeVault('server-1', vault)

    const refreshing = runtimeVault.set('oauth', 'refreshed-token')
    await refreshStarted.promise
    const revoking = authority.revoke('server-1', () => vault.remove('oauth'))
    allowRefreshCommit.resolve()

    await Promise.all([refreshing, revoking])
    expect(values.has('oauth')).toBe(false)
    await expect(runtimeVault.set('oauth', 'resurrected-token')).rejects.toThrow(
      'credentials changed',
    )
    expect(values.has('oauth')).toBe(false)
  })

  it('allows only the current explicit authorization lease to restore runtime access', async () => {
    const values = new Map<string, string>()
    const vault = {
      resolve: async (name: string) => {
        const value = values.get(name)
        if (value === undefined) throw new Error(`${name} was not found`)
        return value
      },
      set: async (name: string, value: string) => {
        values.set(name, value)
      },
      remove: async (name: string) => {
        values.delete(name)
      },
    }
    const authority = createMcpOAuthVaultAuthority()
    const oldRuntimeVault = authority.runtimeVault('server-1', vault)
    await authority.revoke('server-1', () => vault.remove('oauth'))
    const authorization = authority.beginAuthorization('server-1', vault)

    await authorization.vault.set('oauth', 'authorized-token')
    await authorization.finish()
    await expect(oldRuntimeVault.resolve('oauth')).rejects.toThrow('credentials changed')

    const currentRuntimeVault = authority.runtimeVault('server-1', vault)
    await expect(currentRuntimeVault.resolve('oauth')).resolves.toBe('authorized-token')
  })
})
