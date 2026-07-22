import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveredExtensionPackage } from '../types'

const electronNetMocks = vi.hoisted(() => {
  const fetch = vi.fn((input: string | Request, init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify({ input, redirect: init?.redirect ?? null }))),
  )
  const request = vi.fn((options: unknown) => ({ options }))

  return {
    net: { fetch, request },
    originalFetch: fetch,
    originalRequest: request,
  }
})

vi.mock('electron', () => ({
  net: electronNetMocks.net,
}))

let originalFetch: typeof globalThis.fetch

function installHostFetchMock() {
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify({ input, redirect: init?.redirect ?? null }))),
  )
  globalThis.fetch = fetch
  return fetch
}

function resetElectronNetMocks() {
  electronNetMocks.originalFetch.mockClear()
  electronNetMocks.originalRequest.mockClear()
  electronNetMocks.net.fetch = electronNetMocks.originalFetch
  electronNetMocks.net.request = electronNetMocks.originalRequest
}

function policyPackage(): DiscoveredExtensionPackage {
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
    resetElectronNetMocks()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    resetElectronNetMocks()
  })

  it('only forces fetch redirect errors while a trusted main policy is active', async () => {
    const fetch = installHostFetchMock()
    const { createTrustedMainNetworkPolicy, runWithTrustedMainNetworkPolicy } = await import(
      '../trusted-main-network-egress'
    )
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
    const { createTrustedMainNetworkPolicy, runWithTrustedMainNetworkPolicy } = await import(
      '../trusted-main-network-egress'
    )
    const policy = createTrustedMainNetworkPolicy(policyPackage())

    await expect(
      runWithTrustedMainNetworkPolicy(policy, () =>
        globalThis.fetch(new Request('https://allowed.example/request')),
      ),
    ).rejects.toThrow('Request objects can preserve custom fetch agents or dispatchers')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('only forces Electron net redirect errors while a trusted main policy is active', async () => {
    installHostFetchMock()
    const { net } = await import('electron')
    const { createTrustedMainNetworkPolicy, runWithTrustedMainNetworkPolicy } = await import(
      '../trusted-main-network-egress'
    )
    const policy = createTrustedMainNetworkPolicy(policyPackage())

    await runWithTrustedMainNetworkPolicy(policy, () =>
      net.fetch('https://allowed.example/redirect'),
    )
    expect(electronNetMocks.originalFetch).toHaveBeenLastCalledWith(
      'https://allowed.example/redirect',
      { redirect: 'error' },
    )

    await net.fetch('https://outside.example/redirect', { redirect: 'follow' })
    expect(electronNetMocks.originalFetch).toHaveBeenLastCalledWith(
      'https://outside.example/redirect',
      { redirect: 'follow' },
    )

    runWithTrustedMainNetworkPolicy(policy, () => net.request('https://allowed.example/redirect'))
    expect(electronNetMocks.originalRequest).toHaveBeenLastCalledWith({
      url: 'https://allowed.example/redirect',
      redirect: 'error',
    })

    net.request('https://outside.example/redirect')
    expect(electronNetMocks.originalRequest).toHaveBeenLastCalledWith(
      'https://outside.example/redirect',
    )
  })
})
