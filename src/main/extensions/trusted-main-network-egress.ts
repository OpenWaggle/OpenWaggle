import { AsyncLocalStorage } from 'node:async_hooks'
import type { EventEmitter } from 'node:events'
import type { ClientRequestConstructorOptions } from 'electron'
import * as electronRuntime from 'electron'
import {
  installTrustedMainNetworkCallbackGuard,
  type TrustedMainEventListener,
} from './trusted-main-network-callback-guard'
import { installTrustedMainNetworkEscapeGuard } from './trusted-main-network-escape-guard'
import { installTrustedMainHttpNetworkGuard } from './trusted-main-network-http-guard'
import { installTrustedMainSocketNetworkGuard } from './trusted-main-network-socket-guard'
import type { DiscoveredExtensionPackage } from './types'

const HTTP_PROTOCOL = 'http:'
const HTTPS_PROTOCOL = 'https:'
const HTTP_DEFAULT_HOST = 'localhost'
const HTTP_DEFAULT_PATH = '/'
const HTTP_DEFAULT_PORT = '80'
const HTTPS_DEFAULT_PORT = '443'
const UNSAFE_FETCH_TRANSPORT_PROPERTIES = [
  ['agent', 'Custom fetch agents can bypass the declared origin.'],
  ['dispatcher', 'Custom fetch dispatchers can bypass the declared origin.'],
] as const
const UNSAFE_FETCH_REQUEST_REASON =
  'Request objects can preserve custom fetch agents or dispatchers that bypass the declared origin.'

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
let internalSocketBypassDepth = 0

export class TrustedMainNetworkEgressError extends Error {
  override name = 'TrustedMainNetworkEgressError'
}

export function createTrustedMainNetworkPolicy(
  extensionPackage: DiscoveredExtensionPackage,
): TrustedMainNetworkPolicy {
  return {
    extensionId: extensionPackage.id,
    allowedOrigins: extensionPackage.manifest?.network?.origins ?? [],
  }
}

export function runWithTrustedMainNetworkPolicy<T>(
  policy: TrustedMainNetworkPolicy,
  operation: () => T,
): T {
  installTrustedMainNetworkGuard()
  return trustedMainNetworkPolicyStorage.run(policy, operation)
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
  if (internalSocketBypassDepth > 0) {
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

function runWithInternalSocketBypass<T>(operation: () => T): T {
  internalSocketBypassDepth += 1
  try {
    return operation()
  } finally {
    internalSocketBypassDepth -= 1
  }
}

function parseUrl(value: string) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function requestInputUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') {
    return parseUrl(input)
  }
  if (input instanceof URL) {
    return input
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return parseUrl(input.url)
  }
  return null
}

function requestInputUnsafeTransportReason(input: RequestInfo | URL) {
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return UNSAFE_FETCH_REQUEST_REASON
  }

  return null
}

function objectHasOwn(value: object, property: string) {
  return Object.hasOwn(value, property)
}

function unsafeFetchTransportReason(init?: RequestInit) {
  if (typeof init !== 'object' || init === null) {
    return null
  }

  for (const [property, reason] of UNSAFE_FETCH_TRANSPORT_PROPERTIES) {
    if (objectHasOwn(init, property)) {
      return reason
    }
  }

  return null
}

function fetchInitWithRedirectError(init?: RequestInit): RequestInit {
  return {
    ...init,
    redirect: 'error',
  }
}

function enforceFetchTarget(api: string, input: RequestInfo | URL, init?: RequestInit) {
  const unsafeTransportReason =
    requestInputUnsafeTransportReason(input) ?? unsafeFetchTransportReason(init)
  enforceNetworkTarget({
    api,
    url: requestInputUrl(input),
    ...(unsafeTransportReason !== null ? { reason: unsafeTransportReason } : {}),
  })
}

function optionString(value: string | number | null | undefined) {
  return value === undefined || value === null ? null : String(value)
}

function defaultPort(protocol: string) {
  return protocol === HTTPS_PROTOCOL ? HTTPS_DEFAULT_PORT : HTTP_DEFAULT_PORT
}

function hostWithPort(input: {
  readonly host: string
  readonly port: string | null
  readonly protocol: string
}) {
  if (input.port === null || input.port === defaultPort(input.protocol)) {
    return input.host
  }
  return `${input.host}:${input.port}`
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

    try {
      enforceFetchTarget('fetch', input, init)
    } catch (error) {
      return Promise.reject(error)
    }

    return originalFetch(input, fetchInitWithRedirectError(init))
  }
}

function electronRequestOptionsUrl(options: ClientRequestConstructorOptions | string) {
  if (typeof options === 'string') {
    return parseUrl(options)
  }
  if (options.url !== undefined) {
    return parseUrl(options.url)
  }

  const protocol = options.protocol ?? HTTP_PROTOCOL
  const host = options.hostname ?? options.host ?? HTTP_DEFAULT_HOST
  const port = optionString(options.port)
  const path = options.path ?? HTTP_DEFAULT_PATH
  return parseUrl(`${protocol}//${hostWithPort({ host, port, protocol })}${path}`)
}

function electronRequestOptionsWithRedirectError(
  options: ClientRequestConstructorOptions | string,
): ClientRequestConstructorOptions {
  if (typeof options === 'string') {
    return {
      url: options,
      redirect: 'error',
    }
  }

  return {
    ...options,
    redirect: 'error',
  }
}

function installElectronNetGuard() {
  const electronNet = electronRuntime.net
  if (typeof electronNet !== 'object' || electronNet === null) {
    return
  }

  const originalElectronFetch = electronNet.fetch.bind(electronNet)
  const originalElectronRequest = electronNet.request.bind(electronNet)

  electronNet.fetch = (input: string | Request, init?: RequestInit) => {
    if (currentPolicy() === null) {
      return originalElectronFetch(input, init)
    }

    try {
      enforceFetchTarget('electron.net.fetch', input, init)
    } catch (error) {
      return Promise.reject(error)
    }

    return originalElectronFetch(input, fetchInitWithRedirectError(init))
  }
  electronNet.request = (options) => {
    if (currentPolicy() === null) {
      return originalElectronRequest(options)
    }

    enforceUrl('electron.net.request', electronRequestOptionsUrl(options))
    return originalElectronRequest(electronRequestOptionsWithRedirectError(options))
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
    runWithInternalSocketBypass,
  })
  installTrustedMainSocketNetworkGuard({ enforceRawSocket })
  installTrustedMainNetworkEscapeGuard({ enforceBlockedApi: enforceBlockedNetworkApi })
  installElectronNetGuard()
  trustedMainNetworkGuardInstalled = true
}
