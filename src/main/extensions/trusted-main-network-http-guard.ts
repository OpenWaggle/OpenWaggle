import http from 'node:http'

const HTTP_PROTOCOL = 'http:'
const HTTPS_PROTOCOL = 'https:'
const HTTP_DEFAULT_HOST = 'localhost'
const HTTP_DEFAULT_PATH = '/'
const UNSAFE_REQUEST_TRANSPORT_PROPERTIES = [
  ['lookup', 'Custom DNS lookup functions can bypass the declared origin.'],
  ['socketPath', 'Unix socket paths can bypass the declared origin.'],
] as const

type AddRequest = (
  this: http.Agent,
  request: http.ClientRequest,
  options: http.RequestOptions,
  ...rest: readonly unknown[]
) => void

export interface TrustedMainHttpNetworkGuard {
  readonly enforceTarget: (input: {
    readonly api: string
    readonly url: URL | null
    readonly reason?: string
  }) => void
  readonly runWithAuthorizedTarget: <T>(url: URL, operation: () => T) => T
}

function isAddRequest(value: unknown): value is AddRequest {
  return typeof value === 'function'
}

function parseUrl(value: string) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function optionString(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null
}

function agentProtocol(agent: http.Agent) {
  const protocol = 'protocol' in agent ? agent.protocol : undefined
  return typeof protocol === 'string' ? protocol : HTTP_PROTOCOL
}

function agentDefaultPort(agent: http.Agent) {
  return optionString('defaultPort' in agent ? agent.defaultPort : undefined)
}

/** The URL a Node HTTP agent is asked to connect to. `addRequest` sees every import style alike. */
function agentRequestUrl(input: {
  readonly agent: http.Agent
  readonly request: http.ClientRequest
  readonly options: http.RequestOptions
}) {
  const protocol = optionString(input.options.protocol) ?? agentProtocol(input.agent)
  const host =
    optionString(input.options.hostname) ?? optionString(input.options.host) ?? HTTP_DEFAULT_HOST
  const port = optionString(input.options.port) ?? agentDefaultPort(input.agent)
  const path = optionString(input.request.path) ?? HTTP_DEFAULT_PATH
  const authority = port === null ? host : `${host.includes(':') ? `[${host}]` : host}:${port}`
  return parseUrl(`${protocol}//${authority}${path}`)
}

function unsafeRequestTransportReason(options: http.RequestOptions) {
  for (const [property, reason] of UNSAFE_REQUEST_TRANSPORT_PROPERTIES) {
    if (options[property] !== undefined && options[property] !== null) {
      return reason
    }
  }
  const agent: unknown = options.agent
  if (agent !== undefined && agent !== null && agent !== false) {
    return 'Custom agents can bypass the declared origin.'
  }
  return null
}

function requestApi(url: URL | null) {
  return url?.protocol === HTTPS_PROTOCOL ? 'node:https.request' : 'node:http.request'
}

/**
 * Checks every Node HTTP(S) request where its agent takes it. Patching `http.request` on the
 * module object misses named and namespace imports on Bun, whose builtin ESM exports are fixed
 * when first imported; `Agent.prototype.addRequest` is shared by every import style, by
 * `https.Agent`, and by agents a caller constructs. Requests without an agent (a custom
 * `createConnection`) and agents that override `addRequest` still open their sockets through
 * `net.Socket.prototype.connect`, which denies them because they carry no authorized target.
 */
export function installTrustedMainHttpNetworkGuard(input: TrustedMainHttpNetworkGuard) {
  const prototype: object = http.Agent.prototype
  const addRequestValue = 'addRequest' in prototype ? prototype.addRequest : undefined
  if (!isAddRequest(addRequestValue)) {
    throw new TypeError('node:http Agent.prototype.addRequest is unavailable.')
  }
  const originalAddRequest: AddRequest = addRequestValue

  function addRequest(
    this: http.Agent,
    request: http.ClientRequest,
    options: http.RequestOptions,
    ...rest: readonly unknown[]
  ) {
    const url = agentRequestUrl({ agent: this, request, options })
    const reason = unsafeRequestTransportReason(options)
    input.enforceTarget({ api: requestApi(url), url, ...(reason === null ? {} : { reason }) })
    if (url === null) {
      return Reflect.apply(originalAddRequest, this, [request, options, ...rest])
    }
    return input.runWithAuthorizedTarget(url, () =>
      Reflect.apply(originalAddRequest, this, [request, options, ...rest]),
    )
  }

  Object.defineProperty(http.Agent.prototype, 'addRequest', {
    configurable: true,
    writable: true,
    value: addRequest,
  })
}
