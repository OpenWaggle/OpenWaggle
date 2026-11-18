import { type ClientRequestConstructorOptions, net as electronNet } from 'electron'
import type {
  NetworkFetchShape,
  ShellNetworkEgressPolicy,
} from '../../ports/desktop-shell/network-fetch'

const HTTP_PROTOCOL = 'http:'
const HTTPS_PROTOCOL = 'https:'
const HTTP_DEFAULT_HOST = 'localhost'
const HTTP_DEFAULT_PATH = '/'
const HTTP_DEFAULT_PORT = '80'
const HTTPS_DEFAULT_PORT = '443'

function parseUrl(value: string) {
  try {
    return new URL(value)
  } catch {
    return null
  }
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
) {
  if (typeof options === 'string') {
    return {
      url: options,
      redirect: 'error',
    } satisfies ClientRequestConstructorOptions
  }

  return {
    ...options,
    redirect: 'error',
  } satisfies ClientRequestConstructorOptions
}

function guardElectronNet(policy: ShellNetworkEgressPolicy) {
  if (typeof electronNet !== 'object' || electronNet === null) {
    return
  }

  const originalElectronFetch = electronNet.fetch.bind(electronNet)
  const originalElectronRequest = electronNet.request.bind(electronNet)

  electronNet.fetch = (input: string | Request, init?: RequestInit) => {
    if (!policy.isActive()) {
      return originalElectronFetch(input, init)
    }

    try {
      policy.checkFetch('electron.net.fetch', input, init)
    } catch (error) {
      return Promise.reject(error)
    }

    return originalElectronFetch(input, { ...init, redirect: 'error' })
  }
  electronNet.request = (options) => {
    if (!policy.isActive()) {
      return originalElectronRequest(options)
    }

    policy.checkUrl('electron.net.request', electronRequestOptionsUrl(options))
    return originalElectronRequest(electronRequestOptionsWithRedirectError(options))
  }
}

/** Electron's `net`: Chromium's network stack, with the system proxy, PAC and `file:` URLs. */
export const electronNetworkFetch: NetworkFetchShape = {
  fetch: (input, init) => electronNet.fetch(input, init),
  guardExtensionEgress: guardElectronNet,
}
