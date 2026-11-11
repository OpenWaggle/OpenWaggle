import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveredExtensionPackage } from '../types'

const shellNetwork = vi.hoisted(() => ({
  send: vi.fn((input: string | Request, init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify({ input, redirect: init?.redirect ?? null }))),
  ),
}))

// The shell's own network stack, over a recorded send, so the guard it installs is the real one.
vi.mock('../../desktop-shell/network-fetch', async () => {
  const { createBunNetworkFetch } =
    await import('../../adapters/electrobun/electrobun-network-fetch')
  return { networkFetch: createBunNetworkFetch(shellNetwork.send) }
})

let originalFetch: typeof globalThis.fetch

function installHostFetchMock() {
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify({ input, redirect: init?.redirect ?? null }))),
  )
  globalThis.fetch = fetch
  return fetch
}

function policyPackage() {
  return fromPartial<DiscoveredExtensionPackage>({
    id: 'network-policy-extension',
    manifest: {
      network: {
        origins: ['https://allowed.example'],
      },
    },
  })
}

describe('trusted main network egress guard', () => {
  beforeEach(() => {
    vi.resetModules()
    originalFetch = globalThis.fetch
    shellNetwork.send.mockClear()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    shellNetwork.send.mockClear()
  })

  it('only forces fetch redirect errors while a trusted main policy is active', async () => {
    const fetch = installHostFetchMock()
    const { createTrustedMainNetworkPolicy, runWithTrustedMainNetworkPolicy } =
      await import('../trusted-main-network-egress')
    const policy = createTrustedMainNetworkPolicy(policyPackage())

    await runWithTrustedMainNetworkPolicy(policy, () =>
      globalThis.fetch('https://allowed.example/redirect'),
    )
    expect(fetch).toHaveBeenLastCalledWith('https://allowed.example/redirect', {
      redirect: 'error',
    })

    await globalThis.fetch('https://outside.example/redirect', { redirect: 'follow' })
    expect(fetch).toHaveBeenLastCalledWith('https://outside.example/redirect', {
      redirect: 'follow',
    })
  })

  it('denies Request inputs because they can preserve custom fetch transports', async () => {
    const fetch = installHostFetchMock()
    const { createTrustedMainNetworkPolicy, runWithTrustedMainNetworkPolicy } =
      await import('../trusted-main-network-egress')
    const policy = createTrustedMainNetworkPolicy(policyPackage())

    await expect(
      runWithTrustedMainNetworkPolicy(policy, () =>
        globalThis.fetch(new Request('https://allowed.example/request')),
      ),
    ).rejects.toThrow('Request objects can preserve custom fetch agents or dispatchers')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('only forces shell network redirect errors while a trusted main policy is active', async () => {
    installHostFetchMock()
    const { networkFetch } = await import('../../desktop-shell/network-fetch')
    const { createTrustedMainNetworkPolicy, runWithTrustedMainNetworkPolicy } =
      await import('../trusted-main-network-egress')
    const policy = createTrustedMainNetworkPolicy(policyPackage())

    await runWithTrustedMainNetworkPolicy(policy, () =>
      networkFetch.fetch('https://allowed.example/redirect'),
    )
    expect(shellNetwork.send).toHaveBeenLastCalledWith('https://allowed.example/redirect', {
      redirect: 'error',
    })

    await expect(
      runWithTrustedMainNetworkPolicy(policy, () =>
        networkFetch.fetch('https://outside.example/redirect'),
      ),
    ).rejects.toThrow()
    expect(shellNetwork.send).toHaveBeenCalledOnce()

    await networkFetch.fetch('https://outside.example/redirect', { redirect: 'follow' })
    expect(shellNetwork.send).toHaveBeenLastCalledWith('https://outside.example/redirect', {
      redirect: 'follow',
    })
  })
})
