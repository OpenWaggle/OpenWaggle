import { lookup } from 'node:dns/promises'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import type { FetchLike } from '@modelcontextprotocol/client'
import { Agent } from 'undici'

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 5
const IP_FAMILY_V4 = 4
const IP_FAMILY_V6 = 6
const HTTP_MOVED_PERMANENTLY = 301
const HTTP_FOUND = 302
const HTTP_SEE_OTHER = 303

export type HostnameResolver = (
  hostname: string,
  options: { readonly all: true; readonly verbatim: true },
) => Promise<readonly { readonly address: string; readonly family: number }[]>

export interface ValidatedMcpNetworkTarget {
  readonly hostname: string
  readonly address: string
  readonly family: 4 | 6
}

type PinnedFetch = (
  url: URL,
  init: RequestInit,
  target: ValidatedMcpNetworkTarget,
) => Promise<Response>

interface DispatcherRequestInit extends RequestInit {
  readonly dispatcher: Agent
}

const resolveHostname: HostnameResolver = (hostname, options) => lookup(hostname, options)

const blockedIpv4Addresses = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, 'ipv4')
}
const blockedIpv6Addresses = new BlockList()
for (const [network, prefix] of [
  ['::', 96],
  ['::ffff:0:0', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, 'ipv6')
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function normalizedAllowedHostname(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    if (!['https:', 'wss:', 'http:', 'ws:'].includes(url.protocol)) return null
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    return url.hostname.toLowerCase()
  } catch {
    return null
  }
}

export function normalizeMcpAllowedHosts(values: readonly string[]) {
  return new Set(
    values
      .map(normalizedAllowedHostname)
      .filter((hostname): hostname is string => hostname !== null),
  )
}

function isAllowedHostname(allowedHosts: ReadonlySet<string>, hostname: string) {
  const normalized = hostname.toLowerCase()
  if (allowedHosts.has(normalized)) return true
  for (const allowed of allowedHosts) {
    if (allowed.startsWith('*.') && normalized.endsWith(allowed.slice(1))) return true
  }
  return false
}

function isPrivateAddress(address: string) {
  const family = isIP(address)
  if (family === IP_FAMILY_V4) return blockedIpv4Addresses.check(address, 'ipv4')
  if (family === IP_FAMILY_V6) return blockedIpv6Addresses.check(address, 'ipv6')
  return true
}

function isLoopbackAddress(address: string) {
  const normalized = address.toLowerCase().split('%')[0] ?? ''
  if (isIP(normalized) === IP_FAMILY_V4) return normalized.startsWith('127.')
  if (isIP(normalized) === IP_FAMILY_V6) {
    return normalized === '::1' || normalized.startsWith('::ffff:127.')
  }
  return false
}

export async function validateMcpNetworkTarget(input: {
  readonly url: URL
  readonly allowedHosts: ReadonlySet<string>
  readonly allowInsecurePrivateNetwork: boolean
  readonly allowLoopback?: boolean
  readonly websocket?: boolean
  readonly resolveHostname?: HostnameResolver
}) {
  if (input.url.username || input.url.password) {
    throw new Error('MCP network URLs cannot contain credentials.')
  }
  assertSecureMcpProtocol(input.url, input.websocket === true)
  if (!isAllowedHostname(input.allowedHosts, input.url.hostname)) {
    throw new Error(`MCP redirect target is not allowlisted: ${input.url.hostname}.`)
  }

  const addresses = await (input.resolveHostname ?? resolveHostname)(input.url.hostname, {
    all: true,
    verbatim: true,
  })
  if (addresses.length === 0)
    throw new Error(`MCP hostname did not resolve: ${input.url.hostname}.`)
  const permitsPrivate =
    input.allowInsecurePrivateNetwork ||
    (input.allowLoopback !== false && isLoopbackHostname(input.url.hostname))
  if (!permitsPrivate && addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error(
      `MCP hostname resolves to a private or reserved address: ${input.url.hostname}.`,
    )
  }
  if (
    isLoopbackHostname(input.url.hostname) &&
    addresses.some(({ address }) => !isLoopbackAddress(address))
  ) {
    throw new Error(`Loopback MCP hostname resolved outside loopback: ${input.url.hostname}.`)
  }

  const selected = addresses[0]
  if (!selected) throw new Error(`MCP hostname did not resolve: ${input.url.hostname}.`)
  const family = isIP(selected.address)
  if (family !== IP_FAMILY_V4 && family !== IP_FAMILY_V6) {
    throw new Error(`MCP hostname resolved to an invalid address: ${input.url.hostname}.`)
  }
  return {
    hostname: input.url.hostname,
    address: selected.address,
    family,
  } satisfies ValidatedMcpNetworkTarget
}

export function createPinnedMcpLookup(target: ValidatedMcpNetworkTarget): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address: target.address, family: target.family }])
      return
    }
    callback(null, target.address, target.family)
  }
}

function dispatcherFor(target: ValidatedMcpNetworkTarget, dispatchers: Map<string, Agent>) {
  const key = `${target.hostname.toLowerCase()}\0${target.address}\0${String(target.family)}`
  const existing = dispatchers.get(key)
  if (existing) return existing
  const dispatcher = new Agent({
    connect: {
      lookup: createPinnedMcpLookup(target),
      ...(isIP(target.hostname) === 0 ? { servername: target.hostname } : {}),
    },
  })
  dispatchers.set(key, dispatcher)
  return dispatcher
}

export type SecureMcpFetch = FetchLike & { readonly close: () => Promise<void> }

function assertSecureMcpProtocol(url: URL, websocket: boolean) {
  const secureProtocol = websocket ? 'wss:' : 'https:'
  if (url.protocol === secureProtocol) return
  const loopbackProtocol = websocket ? 'ws:' : 'http:'
  if (url.protocol === loopbackProtocol && isLoopbackHostname(url.hostname)) return
  throw new Error(
    `MCP network connections require ${secureProtocol} except for explicit loopback URLs.`,
  )
}

function redirectRequestInit(status: number, init: RequestInit): RequestInit {
  if (
    status !== HTTP_SEE_OTHER &&
    !((status === HTTP_MOVED_PERMANENTLY || status === HTTP_FOUND) && init.method === 'POST')
  ) {
    return init
  }
  const headers = new Headers(init.headers)
  headers.delete('content-length')
  headers.delete('content-type')
  return { ...init, method: 'GET', body: undefined, headers }
}

function redirectCredentials(originChanged: boolean, init: RequestInit): RequestInit {
  if (!originChanged) return init
  const headers = new Headers(init.headers)
  headers.delete('authorization')
  headers.delete('cookie')
  headers.delete('proxy-authorization')
  return { ...init, headers }
}

export function createSecureMcpFetch(input: {
  readonly baseUrl: URL
  readonly allowedDomains?: readonly string[]
  readonly allowInsecurePrivateNetwork?: boolean
  readonly allowLoopback?: boolean
  readonly fetchFn?: PinnedFetch
  readonly resolveHostname?: HostnameResolver
}): SecureMcpFetch {
  const allowedHosts = normalizeMcpAllowedHosts([
    input.baseUrl.hostname,
    ...(input.allowedDomains ?? []),
  ])
  const dispatchers = new Map<string, Agent>()
  const pinnedFetch: PinnedFetch = async (url, init, target) => {
    const requestInit: DispatcherRequestInit = {
      ...init,
      dispatcher: dispatcherFor(target, dispatchers),
    }
    return fetch(url, requestInit)
  }

  return Object.assign(
    async (urlInput: Parameters<FetchLike>[0], requestInit: RequestInit = {}) => {
      let url = new URL(typeof urlInput === 'string' ? urlInput : urlInput.toString())
      let init: RequestInit = { ...requestInit, redirect: 'manual' }

      for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
        const target = await validateMcpNetworkTarget({
          url,
          allowedHosts,
          allowInsecurePrivateNetwork: input.allowInsecurePrivateNetwork === true,
          ...(input.allowLoopback !== undefined ? { allowLoopback: input.allowLoopback } : {}),
          ...(input.resolveHostname ? { resolveHostname: input.resolveHostname } : {}),
        })
        const response = await (input.fetchFn ?? pinnedFetch)(url, init, target)
        if (!REDIRECT_STATUSES.has(response.status)) return response
        if (redirectCount === MAX_REDIRECTS) throw new Error('MCP HTTP redirect limit exceeded.')
        const location = response.headers.get('location')
        if (!location) throw new Error('MCP HTTP redirect did not include a Location header.')
        const nextUrl = new URL(location, url)
        init = {
          ...redirectCredentials(
            nextUrl.origin !== url.origin,
            redirectRequestInit(response.status, init),
          ),
          redirect: 'manual',
        }
        url = nextUrl
      }

      throw new Error('MCP HTTP redirect limit exceeded.')
    },
    {
      async close() {
        const activeDispatchers = [...dispatchers.values()]
        dispatchers.clear()
        await Promise.all(activeDispatchers.map((dispatcher) => dispatcher.close()))
      },
    },
  )
}
