import { syncBuiltinESMExports } from 'node:module'
import net from 'node:net'
import tls from 'node:tls'

const HTTP_DEFAULT_HOST = 'localhost'
const FIRST_ARGUMENT_INDEX = 0
const SECOND_ARGUMENT_INDEX = 1
const THIRD_ARGUMENT_INDEX = 2
const FOURTH_ARGUMENT_INDEX = 3

export interface TrustedMainSocketNetworkGuard {
  readonly enforceRawSocket: (api: string) => void
}

function isSocketConnectOptions(value: unknown): value is net.NetConnectOpts {
  return typeof value === 'object' && value !== null && !(value instanceof URL)
}

function isSecureSocketConnectOptions(value: unknown): value is tls.ConnectionOptions {
  return typeof value === 'object' && value !== null && !(value instanceof URL)
}

function isConnectListener(value: unknown): value is () => void {
  return typeof value === 'function'
}

function callNetCreateConnection(
  originalCreateConnection: typeof net.createConnection,
  args: readonly unknown[],
): net.Socket {
  const first = args[FIRST_ARGUMENT_INDEX]
  const second = args[SECOND_ARGUMENT_INDEX]
  const third = args[THIRD_ARGUMENT_INDEX]

  if (typeof first === 'number') {
    if (typeof second === 'string') {
      return isConnectListener(third)
        ? originalCreateConnection(first, second, third)
        : originalCreateConnection(first, second)
    }
    return isConnectListener(second)
      ? originalCreateConnection(first, HTTP_DEFAULT_HOST, second)
      : originalCreateConnection(first)
  }

  if (typeof first === 'string') {
    return isConnectListener(second)
      ? originalCreateConnection(first, second)
      : originalCreateConnection(first)
  }

  if (isSocketConnectOptions(first)) {
    return isConnectListener(second)
      ? originalCreateConnection(first, second)
      : originalCreateConnection(first)
  }

  throw new TypeError('net.createConnection requires connection options, a port, or a path.')
}

function callTlsConnect(
  originalConnect: typeof tls.connect,
  args: readonly unknown[],
): tls.TLSSocket {
  const first = args[FIRST_ARGUMENT_INDEX]
  const second = args[SECOND_ARGUMENT_INDEX]
  const third = args[THIRD_ARGUMENT_INDEX]
  const fourth = args[FOURTH_ARGUMENT_INDEX]

  if (typeof first === 'number') {
    if (typeof second === 'string') {
      if (isSecureSocketConnectOptions(third)) {
        return isConnectListener(fourth)
          ? originalConnect(first, second, third, fourth)
          : originalConnect(first, second, third)
      }
      return isConnectListener(third)
        ? originalConnect(first, second, {}, third)
        : originalConnect(first, second)
    }
    if (isSecureSocketConnectOptions(second)) {
      return isConnectListener(third)
        ? originalConnect(first, second, third)
        : originalConnect(first, second)
    }
    return isConnectListener(second) ? originalConnect(first, {}, second) : originalConnect(first)
  }

  if (isSecureSocketConnectOptions(first)) {
    return isConnectListener(second) ? originalConnect(first, second) : originalConnect(first)
  }

  throw new TypeError('tls.connect requires connection options or a port.')
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

export function installTrustedMainSocketNetworkGuard(input: TrustedMainSocketNetworkGuard) {
  const originalNetCreateConnection = net.createConnection
  const originalTlsConnect = tls.connect

  definePatchedFunction(net, 'createConnection', (...args) => {
    input.enforceRawSocket('node:net.createConnection')
    return callNetCreateConnection(originalNetCreateConnection, args)
  })
  definePatchedFunction(net, 'connect', (...args) => {
    input.enforceRawSocket('node:net.connect')
    return callNetCreateConnection(originalNetCreateConnection, args)
  })
  definePatchedFunction(tls, 'connect', (...args) => {
    input.enforceRawSocket('node:tls.connect')
    return callTlsConnect(originalTlsConnect, args)
  })

  syncBuiltinESMExports()
}
