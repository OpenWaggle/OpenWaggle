import { Context } from 'effect'

/**
 * What a trusted-main extension may reach, checked before the shell's network stack sends a
 * request on its behalf. Each check throws the extension's policy error to refuse.
 */
export interface ShellNetworkEgressPolicy {
  /** `false` outside a trusted-main extension's code, where nothing is checked. */
  readonly isActive: () => boolean
  readonly checkFetch: (api: string, input: string | Request, init?: RequestInit) => void
  readonly checkUrl: (api: string, url: URL | null) => void
}

/**
 * The shell's own network stack (ADR 0064). Electron's `net` follows the system proxy and PAC
 * settings and reads `file:` URLs as streaming responses with the file's content type; every
 * adapter must keep both.
 */
export interface NetworkFetchShape {
  readonly fetch: (input: string | Request, init?: RequestInit) => Promise<Response>
  /**
   * Routes every request trusted-main extension code sends through the shell's network module
   * past `policy`, with redirects refused so a checked URL cannot lead elsewhere.
   */
  readonly guardExtensionEgress: (policy: ShellNetworkEgressPolicy) => void
}

export class NetworkFetch extends Context.Tag('@openwaggle/NetworkFetch')<
  NetworkFetch,
  NetworkFetchShape
>() {}
