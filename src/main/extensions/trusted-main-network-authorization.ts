import { AsyncLocalStorage } from 'node:async_hooks'

const HTTPS_DEFAULT_PORT = '443'
const IPV6_HOST_PATTERN = /^\[(.*)\]$/u

interface AuthorizedNetworkTarget {
  readonly hostname: string
  readonly port: string
}

/**
 * The declared HTTPS origin a guarded request (fetch or a Node HTTP agent) was allowed to reach.
 * The socket and DNS guards sit below every builtin import style, so they cannot tell a raw socket
 * from the one an allowed request opens; this context, set only around the allowed request, is
 * how they tell them apart.
 */
const authorizedTargetStorage = new AsyncLocalStorage<AuthorizedNetworkTarget>()

function bareHostname(hostname: string) {
  return IPV6_HOST_PATTERN.exec(hostname)?.[1] ?? hostname
}

export function runWithAuthorizedNetworkTarget<T>(url: URL, operation: () => T): T {
  return authorizedTargetStorage.run(
    { hostname: bareHostname(url.hostname), port: url.port || HTTPS_DEFAULT_PORT },
    operation,
  )
}

/** Runs a trusted main activation without an authorization it could inherit from its caller. */
export function runWithoutAuthorizedNetworkTarget<T>(operation: () => T): T {
  return authorizedTargetStorage.exit(operation)
}

export function isAuthorizedSocketTarget(input: {
  readonly host: unknown
  readonly port: unknown
}) {
  const target = authorizedTargetStorage.getStore()
  if (!target || typeof input.host !== 'string') {
    return false
  }
  if (typeof input.port !== 'string' && typeof input.port !== 'number') {
    return false
  }
  return bareHostname(input.host) === target.hostname && String(input.port) === target.port
}

export function isAuthorizedHostname(hostname: unknown) {
  const target = authorizedTargetStorage.getStore()
  return target !== undefined && typeof hostname === 'string' && hostname === target.hostname
}
