import http from 'node:http'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'

const HTTP_PROTOCOL = 'http:'
const HTTPS_PROTOCOL = 'https:'
const HTTP_DEFAULT_HOST = 'localhost'
const HTTP_DEFAULT_PATH = '/'
const HTTP_DEFAULT_PORT = '80'
const HTTPS_DEFAULT_PORT = '443'
const FIRST_ARGUMENT_INDEX = 0
const SECOND_ARGUMENT_INDEX = 1
const THIRD_ARGUMENT_INDEX = 2
const UNSAFE_REQUEST_TRANSPORT_PROPERTIES = [
  ['lookup', 'Custom DNS lookup functions can bypass the declared origin.'],
  ['socketPath', 'Unix socket paths can bypass the declared origin.'],
] as const

interface RequestTarget {
  readonly url: URL | null
  readonly unsafeTransportReason: string | null
}

export interface TrustedMainHttpNetworkGuard {
  readonly enforceTarget: (input: {
    readonly api: string
    readonly url: URL | null
    readonly reason?: string
  }) => void
  readonly runWithInternalSocketBypass: <T>(operation: () => T) => T
}

function parseUrl(value: string) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function isRequestCallback(value: unknown): value is (response: http.IncomingMessage) => void {
  return typeof value === 'function'
}

function isUrlInput(value: unknown): value is string | URL {
  return typeof value === 'string' || value instanceof URL
}

function isRequestOptions(value: unknown): value is http.RequestOptions {
  return typeof value === 'object' && value !== null && !(value instanceof URL)
}

function requestInputUrl(input: string | URL) {
  return typeof input === 'string' ? parseUrl(input) : input
}

function optionString(value: string | number | null | undefined) {
  return value === undefined || value === null ? null : String(value)
}

function pathFromUrl(url: URL | null) {
  if (!url) {
    return HTTP_DEFAULT_PATH
  }
  return `${url.pathname}${url.search}`
}

function hostFromOptions(options: http.RequestOptions | null) {
  if (!options) {
    return null
  }
  return optionString(options.hostname) ?? optionString(options.host)
}

function portFromOptions(options: http.RequestOptions | null) {
  return optionString(options?.port)
}

function protocolFromOptions(options: http.RequestOptions | null, defaultProtocol: string) {
  return options?.protocol ?? defaultProtocol
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

function requestOptionsTarget(input: {
  readonly defaultProtocol: typeof HTTP_PROTOCOL | typeof HTTPS_PROTOCOL
  readonly options: http.RequestOptions | null
  readonly baseUrl: URL | null
}) {
  const protocol = protocolFromOptions(
    input.options,
    input.baseUrl?.protocol ?? input.defaultProtocol,
  )
  const host = hostFromOptions(input.options) ?? input.baseUrl?.hostname ?? HTTP_DEFAULT_HOST
  const port = portFromOptions(input.options) ?? input.baseUrl?.port ?? null
  const path = input.options?.path ?? pathFromUrl(input.baseUrl)

  return parseUrl(`${protocol}//${hostWithPort({ host, port, protocol })}${path}`)
}

function unsafeRequestTransportReason(options: http.RequestOptions | null) {
  if (!options) {
    return null
  }
  for (const [property, reason] of UNSAFE_REQUEST_TRANSPORT_PROPERTIES) {
    if (options[property] !== undefined) {
      return reason
    }
  }
  if (options.createConnection !== undefined) {
    return 'Custom connection factories can bypass the declared origin.'
  }
  if (options.agent !== undefined && options.agent !== false) {
    return 'Custom agents can bypass the declared origin.'
  }
  return null
}

function httpRequestTarget(
  defaultProtocol: typeof HTTP_PROTOCOL | typeof HTTPS_PROTOCOL,
  args: readonly unknown[],
): RequestTarget {
  const first = args[FIRST_ARGUMENT_INDEX]
  const baseUrl = isUrlInput(first) ? requestInputUrl(first) : null
  const second = args[SECOND_ARGUMENT_INDEX]
  const options = isRequestOptions(first) ? first : isRequestOptions(second) ? second : null

  return {
    url: requestOptionsTarget({ defaultProtocol, options, baseUrl }),
    unsafeTransportReason: unsafeRequestTransportReason(options),
  }
}

function enforceRequestTarget(
  input: TrustedMainHttpNetworkGuard,
  api: string,
  target: RequestTarget,
) {
  if (target.unsafeTransportReason !== null) {
    input.enforceTarget({
      api,
      url: target.url,
      reason: target.unsafeTransportReason,
    })
    return
  }

  input.enforceTarget({ api, url: target.url })
}

function callHttpRequest(
  originalRequest: typeof http.request,
  args: readonly unknown[],
): http.ClientRequest {
  const first = args[FIRST_ARGUMENT_INDEX]
  const second = args[SECOND_ARGUMENT_INDEX]
  const third = args[THIRD_ARGUMENT_INDEX]

  if (isUrlInput(first)) {
    if (isRequestOptions(second)) {
      return isRequestCallback(third)
        ? originalRequest(first, second, third)
        : originalRequest(first, second)
    }
    return isRequestCallback(second) ? originalRequest(first, second) : originalRequest(first)
  }

  if (isRequestOptions(first)) {
    return isRequestCallback(second) ? originalRequest(first, second) : originalRequest(first)
  }

  return isRequestCallback(first)
    ? originalRequest({ protocol: HTTP_PROTOCOL }, first)
    : originalRequest({ protocol: HTTP_PROTOCOL })
}

function callHttpsRequest(
  originalRequest: typeof https.request,
  args: readonly unknown[],
): http.ClientRequest {
  const first = args[FIRST_ARGUMENT_INDEX]
  const second = args[SECOND_ARGUMENT_INDEX]
  const third = args[THIRD_ARGUMENT_INDEX]

  if (isUrlInput(first)) {
    if (isRequestOptions(second)) {
      return isRequestCallback(third)
        ? originalRequest(first, second, third)
        : originalRequest(first, second)
    }
    return isRequestCallback(second) ? originalRequest(first, second) : originalRequest(first)
  }

  if (isRequestOptions(first)) {
    return isRequestCallback(second) ? originalRequest(first, second) : originalRequest(first)
  }

  return isRequestCallback(first)
    ? originalRequest({ protocol: HTTPS_PROTOCOL }, first)
    : originalRequest({ protocol: HTTPS_PROTOCOL })
}

function definePatchedFunction(
  target: object,
  propertyName: string,
  value: (...args: readonly unknown[]) => unknown,
) {
  Object.defineProperty(target, propertyName, {
    configurable: true,
    writable: true,
    value,
  })
}

export function installTrustedMainHttpNetworkGuard(input: TrustedMainHttpNetworkGuard) {
  const originalHttpRequest = http.request
  const originalHttpsRequest = https.request

  definePatchedFunction(http, 'request', (...args) => {
    enforceRequestTarget(input, 'node:http.request', httpRequestTarget(HTTP_PROTOCOL, args))
    return input.runWithInternalSocketBypass(() => callHttpRequest(originalHttpRequest, args))
  })
  definePatchedFunction(http, 'get', (...args) => {
    enforceRequestTarget(input, 'node:http.get', httpRequestTarget(HTTP_PROTOCOL, args))
    const request = input.runWithInternalSocketBypass(() =>
      callHttpRequest(originalHttpRequest, args),
    )
    request.end()
    return request
  })
  definePatchedFunction(https, 'request', (...args) => {
    enforceRequestTarget(input, 'node:https.request', httpRequestTarget(HTTPS_PROTOCOL, args))
    return input.runWithInternalSocketBypass(() => callHttpsRequest(originalHttpsRequest, args))
  })
  definePatchedFunction(https, 'get', (...args) => {
    enforceRequestTarget(input, 'node:https.get', httpRequestTarget(HTTPS_PROTOCOL, args))
    const request = input.runWithInternalSocketBypass(() =>
      callHttpsRequest(originalHttpsRequest, args),
    )
    request.end()
    return request
  })

  syncBuiltinESMExports()
}
