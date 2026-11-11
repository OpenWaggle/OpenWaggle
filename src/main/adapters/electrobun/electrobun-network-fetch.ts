import type {
  NetworkFetchShape,
  ShellNetworkEgressPolicy,
} from '../../ports/desktop-shell/network-fetch'

/**
 * Bun's `fetch` as the shell's network stack (ADR 0064). It reads `file:` URLs as file-backed
 * responses with the file's content type, as Electron's `net.fetch` did, and follows the system
 * proxy through the variables the boot shell sets from it (`electrobun-system-proxy.ts`).
 *
 * Electrobun has no network module of its own for extension code to import, so the egress guard
 * covers this port: a request sent through it while trusted-main extension code runs is checked
 * and sent with redirects refused. The global `fetch` has its own guard
 * (`trusted-main-network-runtime-globals-guard.ts`).
 */
type Send = (input: string | Request, init?: RequestInit) => Promise<Response>

export function createBunNetworkFetch(send: Send): NetworkFetchShape {
  const guard: { policy: ShellNetworkEgressPolicy | null } = { policy: null }
  return {
    fetch: (input, init) => {
      const policy = guard.policy
      if (!policy?.isActive()) return send(input, init)
      try {
        policy.checkFetch('openwaggle.networkFetch', input, init)
      } catch (error) {
        return Promise.reject(error)
      }
      return send(input, { ...init, redirect: 'error' })
    },
    guardExtensionEgress: (policy) => {
      guard.policy = policy
    },
  }
}

/** The process's `fetch` as it is at load, before any extension guard wraps the global. */
const processFetch = globalThis.fetch.bind(globalThis)

export const electrobunNetworkFetch = createBunNetworkFetch((input, init) =>
  processFetch(input, init),
)
