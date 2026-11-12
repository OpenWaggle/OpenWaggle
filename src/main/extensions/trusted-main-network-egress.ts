import { AsyncLocalStorage } from 'node:async_hooks'
import type { EventEmitter } from 'node:events'
import { networkFetch } from '../desktop-shell/network-fetch'
import {
  isAuthorizedHostname,
  isAuthorizedSocketTarget,
  runWithAuthorizedNetworkTarget,
  runWithoutAuthorizedNetworkTarget,
} from './trusted-main-network-authorization'
import {
  installTrustedMainNetworkCallbackGuard,
  type TrustedMainEventListener,
} from './trusted-main-network-callback-guard'
import { installTrustedMainNetworkEscapeGuard } from './trusted-main-network-escape-guard'
import { fetchInitWithRedirectError, fetchRequestTarget } from './trusted-main-network-fetch-target'
import { installTrustedMainHttpNetworkGuard } from './trusted-main-network-http-guard'
import { installTrustedMainRuntimeGlobalsGuard } from './trusted-main-network-runtime-globals-guard'
import { installTrustedMainSocketNetworkGuard } from './trusted-main-network-socket-guard'
import type { DiscoveredExtensionPackage } from './types'

const HTTPS_PROTOCOL = 'https:'

interface TrustedMainNetworkPolicy {
  readonly extensionId: string
  readonly allowedOrigins: readonly string[]
}

interface EnforceNetworkTargetInput {
  readonly api: string
  readonly url: URL | null
  readonly reason?: string
}

const trustedMainNetworkPolicyStorage = new AsyncLocalStorage<TrustedMainNetworkPolicy>()

let trustedMainNetworkGuardInstalled = false

export class TrustedMainNetworkEgressError extends Error {
  override name = 'TrustedMainNetworkEgressError'
}

export function createTrustedMainNetworkPolicy(extensionPackage: DiscoveredExtensionPackage) {
  const policy: TrustedMainNetworkPolicy = {
    extensionId: extensionPackage.id,
    allowedOrigins: extensionPackage.manifest?.network?.origins ?? [],
  }
  return policy
}

export function runWithTrustedMainNetworkPolicy<T>(
  policy: TrustedMainNetworkPolicy,
  operation: () => T,
) {
  installTrustedMainNetworkGuard()
  return runWithoutAuthorizedNetworkTarget(() =>
    trustedMainNetworkPolicyStorage.run(policy, operation),
  )
}

function currentPolicy() {
  return trustedMainNetworkPolicyStorage.getStore() ?? null
}

function bindEventListenerToCurrentPolicy(listener: TrustedMainEventListener) {
  const policy = currentPolicy()
  if (!policy) {
    return listener
  }

  const boundListener = function policyBoundEventListener(this: EventEmitter, ...args: unknown[]) {
    return trustedMainNetworkPolicyStorage.run(policy, () => listener.apply(this, args))
  }
  Object.defineProperty(boundListener, 'listener', { configurable: true, value: listener })
  return boundListener
}

function trustedMainNetworkError(input: {
  readonly policy: TrustedMainNetworkPolicy
  readonly api: string
  readonly target: string
  readonly reason?: string
}) {
  const allowedOrigins =
    input.policy.allowedOrigins.length > 0 ? input.policy.allowedOrigins.join(', ') : '<none>'
  const reasonSuffix = input.reason === undefined ? '' : ` ${input.reason}`
  return new TrustedMainNetworkEgressError(
    `Trusted main extension "${input.policy.extensionId}" attempted undeclared network egress through ${input.api} to ${input.target}.${reasonSuffix} Declared origins: ${allowedOrigins}.`,
  )
}

function enforceNetworkTarget(input: EnforceNetworkTargetInput) {
  const policy = currentPolicy()
  if (!policy) {
    return
  }

  if (input.reason !== undefined) {
    throw trustedMainNetworkError({
      policy,
      api: input.api,
      target: input.url?.toString() ?? '<unresolved>',
      reason: input.reason,
    })
  }

  if (!input.url) {
    throw trustedMainNetworkError({
      policy,
      api: input.api,
      target: '<unresolved>',
      reason: 'Failing closed because the request target could not be resolved.',
    })
  }

  if (input.url.protocol !== HTTPS_PROTOCOL || !policy.allowedOrigins.includes(input.url.origin)) {
    throw trustedMainNetworkError({ policy, api: input.api, target: input.url.toString() })
  }
}

function enforceUrl(api: string, url: URL | null) {
  enforceNetworkTarget({ api, url })
}

function enforceRawSocket(api: string) {
  const policy = currentPolicy()
  if (!policy) {
    return
  }

  throw trustedMainNetworkError({
    policy,
    api,
    target: '<raw-socket>',
    reason: 'Raw sockets are not permitted by extension network origin policy.',
  })
}

function enforceBlockedNetworkApi(api: string, reason: string) {
  const policy = currentPolicy()
  if (!policy) {
    return
  }

  throw trustedMainNetworkError({
    policy,
    api,
    target: '<blocked-api>',
    reason,
  })
}

/** Lets the sockets and DNS lookups of an allowed request through the lower guards. */
function runWithAuthorizedTarget<T>(url: URL, operation: () => T) {
  return currentPolicy() === null ? operation() : runWithAuthorizedNetworkTarget(url, operation)
}

function isPolicyActive() {
  return currentPolicy() !== null
}

function enforceFetchTarget(api: string, input: RequestInfo | URL, init?: RequestInit) {
  const target = fetchRequestTarget(input, init)
  enforceNetworkTarget({
    api,
    url: target.url,
    ...(target.unsafeTransportReason !== null ? { reason: target.unsafeTransportReason } : {}),
  })
  return target.url
}

function installFetchGuard() {
  const originalFetch = globalThis.fetch
  if (typeof originalFetch !== 'function') {
    return
  }

  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (currentPolicy() === null) {
      return originalFetch(input, init)
    }

    let url: URL | null
    try {
      url = enforceFetchTarget('fetch', input, init)
    } catch (error) {
      return Promise.reject(error)
    }

    const fetchWithoutRedirects = () => originalFetch(input, fetchInitWithRedirectError(init))
    // Node's fetch opens its TLS socket through `net.Socket.prototype.connect`.
    return url === null
      ? fetchWithoutRedirects()
      : runWithAuthorizedTarget(url, fetchWithoutRedirects)
  }
}

export function installTrustedMainNetworkGuard() {
  if (trustedMainNetworkGuardInstalled) {
    return
  }

  installTrustedMainNetworkCallbackGuard({ bindListener: bindEventListenerToCurrentPolicy })
  installFetchGuard()
  installTrustedMainHttpNetworkGuard({
    enforceTarget: enforceNetworkTarget,
    runWithAuthorizedTarget,
  })
  installTrustedMainSocketNetworkGuard({
    isPolicyActive,
    enforceRawSocket,
    enforceBlockedApi: enforceBlockedNetworkApi,
    isAuthorizedSocketTarget,
  })
  installTrustedMainNetworkEscapeGuard({
    enforceBlockedApi: enforceBlockedNetworkApi,
    isAuthorizedHostname,
  })
  installTrustedMainRuntimeGlobalsGuard({
    enforceBlockedApi: enforceBlockedNetworkApi,
    isAuthorizedHostname,
  })
  networkFetch.guardExtensionEgress({
    isActive: () => currentPolicy() !== null,
    checkFetch: enforceFetchTarget,
    checkUrl: enforceUrl,
  })
  trustedMainNetworkGuardInstalled = true
}
