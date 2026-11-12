import net from 'node:net'
import tls from 'node:tls'

const HTTP_DEFAULT_HOST = 'localhost'
const FIRST_ARGUMENT_INDEX = 0
const SECOND_ARGUMENT_INDEX = 1
const HTTP2_ALPN_PROTOCOL = 'h2'
const RAW_SOCKET_API = 'node:net.Socket.connect'
const HTTP2_API = 'node:http2.connect'
const HTTP2_REASON = 'HTTP/2 clients are not permitted by extension network origin policy.'

type SocketConnect = (this: net.Socket, ...args: readonly unknown[]) => net.Socket

export interface TrustedMainSocketNetworkGuard {
  readonly isPolicyActive: () => boolean
  readonly enforceRawSocket: (api: string) => void
  readonly enforceBlockedApi: (api: string, reason: string) => void
  readonly isAuthorizedSocketTarget: (input: {
    readonly host: unknown
    readonly port: unknown
  }) => boolean
}

interface SocketConnectOptions {
  readonly host?: unknown
  readonly port?: unknown
  readonly path?: unknown
  readonly lookup?: unknown
  readonly socket?: unknown
  readonly fd?: unknown
  readonly ALPNProtocols?: unknown
}

function isSocketConnect(value: unknown): value is SocketConnect {
  return typeof value === 'function'
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

/**
 * The options a `Socket.prototype.connect` call connects with, in each overload Node and Bun
 * accept: `[options, listener]` already normalized by `net.connect`/`tls.connect`, an options
 * object, `port[, host]`, or a Unix socket path.
 */
function socketConnectOptions(args: readonly unknown[]): SocketConnectOptions | null {
  const first = args[FIRST_ARGUMENT_INDEX]
  const second = args[SECOND_ARGUMENT_INDEX]
  const options: unknown = Array.isArray(first) ? first[FIRST_ARGUMENT_INDEX] : first
  if (isObject(options)) {
    const fields: SocketConnectOptions = options
    return {
      host: fields.host ?? HTTP_DEFAULT_HOST,
      port: fields.port,
      path: fields.path,
      lookup: fields.lookup,
      socket: fields.socket,
      fd: fields.fd,
      ALPNProtocols: fields.ALPNProtocols,
    }
  }
  if (typeof options === 'number' || (typeof options === 'string' && /^\d+$/u.test(options))) {
    return { host: typeof second === 'string' ? second : HTTP_DEFAULT_HOST, port: options }
  }
  if (typeof options === 'string') {
    return { path: options }
  }
  return null
}

/** Whether an ALPN list, as names or in its length-prefixed wire format, offers HTTP/2. */
function offersHttp2(alpnProtocols: unknown) {
  if (Array.isArray(alpnProtocols)) {
    return alpnProtocols.some((protocol) => String(protocol) === HTTP2_ALPN_PROTOCOL)
  }
  if (!(alpnProtocols instanceof Uint8Array)) {
    return false
  }
  let offset = 0
  while (offset < alpnProtocols.length) {
    const length = alpnProtocols[offset] ?? 0
    const protocol = Buffer.from(alpnProtocols.subarray(offset + 1, offset + 1 + length))
    if (protocol.toString('latin1') === HTTP2_ALPN_PROTOCOL) {
      return true
    }
    offset += 1 + length
  }
  return false
}

function isAuthorizedTlsConnection(
  guard: TrustedMainSocketNetworkGuard,
  socket: net.Socket,
  options: SocketConnectOptions | null,
) {
  if (!options || !(socket instanceof tls.TLSSocket)) {
    return false
  }
  const overrides = [options.path, options.lookup, options.fd, options.socket]
  if (overrides.some((value) => value !== undefined && value !== null)) {
    return false
  }
  return guard.isAuthorizedSocketTarget({ host: options.host, port: options.port })
}

/**
 * Checks every outgoing TCP or TLS socket where it connects. `net.connect`, `net.createConnection`,
 * `tls.connect`, `new net.Socket().connect()`, HTTP agents and HTTP/2 sessions all reach the shared
 * `net.Socket.prototype.connect` on Node and on Bun, whatever the import style. The only sockets
 * allowed are TLS connections that an allowed HTTPS request opens to its declared origin.
 */
export function installTrustedMainSocketNetworkGuard(guard: TrustedMainSocketNetworkGuard) {
  const prototype: object = net.Socket.prototype
  const connectValue = 'connect' in prototype ? prototype.connect : undefined
  if (!isSocketConnect(connectValue)) {
    throw new TypeError('node:net Socket.prototype.connect is unavailable.')
  }
  const originalConnect: SocketConnect = connectValue

  function connect(this: net.Socket, ...args: readonly unknown[]) {
    if (guard.isPolicyActive()) {
      const options = socketConnectOptions(args)
      if (!isAuthorizedTlsConnection(guard, this, options)) {
        if (offersHttp2(options?.ALPNProtocols)) {
          guard.enforceBlockedApi(HTTP2_API, HTTP2_REASON)
        }
        guard.enforceRawSocket(RAW_SOCKET_API)
      }
    }
    return Reflect.apply(originalConnect, this, args)
  }

  Object.defineProperty(net.Socket.prototype, 'connect', {
    configurable: true,
    writable: true,
    value: connect,
  })
}
