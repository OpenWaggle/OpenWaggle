import { randomBytes } from 'node:crypto'
import type {
  TrustedOriginDeclaration,
  TrustedOriginDomain,
  TrustedOriginHandler,
  TrustedOriginsShape,
} from '../../ports/desktop-shell/trusted-origins'
import {
  answerTrustedRequest,
  capabilityFor,
  type DocumentPolicy,
  domainOfScheme,
  type GatewayHost,
  hasCapability,
  logicalUrlOf,
  notFound,
} from './electrobun-loopback-gateway'
import {
  bunLoopbackServe,
  LOOPBACK_HOSTNAME,
  type LoopbackServe,
  type LoopbackServer,
} from './electrobun-loopback-serve'
import { type RememberedPorts, userDataRememberedPorts } from './electrobun-remembered-ports'

export type { RememberedPorts } from './electrobun-remembered-ports'

/**
 * Electrobun's trusted origins (ADR 0064): Electrobun has no custom schemes beyond `views://`, so
 * every host of every trust domain is its own `Bun.serve` server on `127.0.0.1`, and its port makes
 * it its own web origin. `originOf(domain, host)` is `http://127.0.0.1:<port>/<capability>`.
 *
 * Threat model. Any local process, and any web page a browser on this machine shows, can open a
 * connection to these ports; a page in the app's own webview can address any loopback port. A
 * server therefore answers only requests whose path starts with its host's capability: 192 bits
 * of HMAC-SHA256 over the domain and host, keyed by a secret drawn fresh at every launch. Without
 * it a request gets an empty 404, so a local process or browser page learns nothing of Session
 * images, visualization documents, MCP App documents or extension frames. The handler sees the
 * request as Electron's `<scheme>://<host>/path` (`TRUSTED_ORIGIN_SCHEMES`), so the protocol
 * modules stay the same on both shells.
 *
 * Why a capability path, not a cookie or a header. Pages cannot add headers to subresource and
 * frame requests. Cookies ignore ports, so a cookie for `127.0.0.1` would reach every loopback
 * server a page requests, a visualization's script could send it to a local listener, and fetches
 * across our own origins (the renderer importing extension modules) would not carry it. A path
 * capability travels with relative URLs (module chunks, `./assets`), works for frames, images and
 * CORS requests alike, and is scoped to one host: a frame's script knows only its own, so it can
 * reach no other domain or frame. Referrers leak no more than a page's origin
 * (`strict-origin-when-cross-origin`, `no-referrer` for frames).
 *
 * Origins and storage. Web storage is keyed by origin, so a domain that declares `codeCache` keeps
 * its port between launches (remembered in `<userData>/trusted-origin-ports.json`): the renderer's
 * local storage and compiled code survive a restart. Other hosts get a fresh port, and their first
 * document asks the engine to drop what an earlier user of that port stored
 * (`Clear-Site-Data: "storage"`), as does the next document after `OriginStorage.clear`.
 * `release` stops a host's server; each one holds a file descriptor.
 */
export interface ElectrobunTrustedOrigins extends TrustedOriginsShape {
  /** The trusted host a loopback URL addresses, or null for any other URL. */
  readonly locate: (url: string) => TrustedOriginLocation | null
  /** Asks the engine to drop what pages of these origins stored, on their next document. */
  readonly clearStorage: (origins: readonly string[]) => void
  /** What every document of `domain` gets, such as the renderer's own policy. */
  readonly setDocumentPolicy: (domain: TrustedOriginDomain, policy: () => DocumentPolicy) => void
}

export interface TrustedOriginLocation {
  readonly domain: TrustedOriginDomain
  readonly host: string
  /** The URL as the domain handler sees it: `<scheme>://<host>/path?query#hash`. */
  readonly logicalUrl: string
}

export interface LoopbackTrustedOriginsOptions {
  readonly serve?: LoopbackServe
  readonly secret?: Uint8Array
  readonly rememberedPorts?: RememberedPorts
}

interface HostServer extends GatewayHost {
  readonly origin: string
  readonly base: string
  readonly server: LoopbackServer
}

const SECRET_BYTES = 32
const ANY_LOOPBACK_PORT = `http://${LOOPBACK_HOSTNAME}:*`

function hostKey(domain: TrustedOriginDomain, host: string) {
  return `${domain}/${host}`
}

/** The listening servers, one per host, and how each one finds its port. */
function createHostServers(input: {
  readonly serve: LoopbackServe
  readonly secret: Uint8Array
  readonly remembered: RememberedPorts
  readonly keepsPort: (domain: TrustedOriginDomain) => boolean
  readonly answer: (host: HostServer, request: Request) => Response | Promise<Response>
}) {
  const hosts = new Map<string, HostServer>()
  const byOrigin = new Map<string, HostServer>()

  function listen(domain: TrustedOriginDomain, host: string, ref: { current?: HostServer }) {
    const fetch = (request: Request) =>
      ref.current ? input.answer(ref.current, request) : notFound()
    const keepsPort = input.keepsPort(domain)
    const known = keepsPort ? input.remembered.read()[hostKey(domain, host)] : undefined
    if (known !== undefined) {
      try {
        return { server: input.serve({ port: known, fetch }), fresh: false }
      } catch {
        // Another process took the remembered port; this origin starts over on a new one.
      }
    }
    const server = input.serve({ port: 0, fetch })
    if (keepsPort) {
      input.remembered.write({ ...input.remembered.read(), [hostKey(domain, host)]: server.port })
    }
    return { server, fresh: !keepsPort }
  }

  function get(domain: TrustedOriginDomain, host: string) {
    const existing = hosts.get(hostKey(domain, host))
    if (existing) return existing
    const ref: { current?: HostServer } = {}
    const { server, fresh } = listen(domain, host, ref)
    const origin = `http://${LOOPBACK_HOSTNAME}:${String(server.port)}`
    const capability = capabilityFor(input.secret, domain, host)
    const entry: HostServer = {
      domain,
      host,
      origin,
      base: `${origin}/${capability}`,
      capability,
      server,
      clearStorageOnNextDocument: fresh,
    }
    ref.current = entry
    hosts.set(hostKey(domain, host), entry)
    byOrigin.set(origin, entry)
    return entry
  }

  function release(domain: TrustedOriginDomain, host: string) {
    const entry = hosts.get(hostKey(domain, host))
    if (!entry) return
    hosts.delete(hostKey(domain, host))
    byOrigin.delete(entry.origin)
    entry.server.stop()
  }

  /** The host behind a loopback origin, or behind Electron's `<scheme>://<host>` form of it. */
  function ofOrigin(origin: string) {
    const loopback = byOrigin.get(origin)
    if (loopback) return loopback
    try {
      const url = new URL(origin)
      const domain = domainOfScheme(url.protocol.slice(0, -1))
      return domain ? (hosts.get(hostKey(domain, url.host)) ?? null) : null
    } catch {
      return null
    }
  }

  return { get, release, ofOrigin, byLoopbackOrigin: (origin: string) => byOrigin.get(origin) }
}

export function createLoopbackTrustedOrigins(
  options: LoopbackTrustedOriginsOptions = {},
): ElectrobunTrustedOrigins {
  const declarations = new Map<TrustedOriginDomain, TrustedOriginDeclaration>()
  const handlers = new Map<TrustedOriginDomain, TrustedOriginHandler>()
  const documentPolicies = new Map<TrustedOriginDomain, () => DocumentPolicy>()

  /** A `Location` the handler wrote in scheme form, addressed as pages reach it. */
  function pageUrlOf(logical: string) {
    try {
      const url = new URL(logical)
      const domain = domainOfScheme(url.protocol.slice(0, -1))
      if (!domain) return logical
      return `${servers.get(domain, url.host).base}${url.pathname}${url.search}${url.hash}`
    } catch {
      return logical
    }
  }

  const servers = createHostServers({
    serve: options.serve ?? bunLoopbackServe,
    secret: options.secret ?? randomBytes(SECRET_BYTES),
    remembered: options.rememberedPorts ?? userDataRememberedPorts(),
    keepsPort: (domain) => declarations.get(domain)?.codeCache === true,
    answer: (host, request) =>
      answerTrustedRequest(host, request, {
        handler: handlers.get(host.domain),
        documentPolicy: documentPolicies.get(host.domain)?.() ?? {},
        pageUrlOf,
      }),
  })

  return {
    declare: (list) => {
      for (const declaration of list) declarations.set(declaration.domain, declaration)
    },
    serve: (domain, handler) => {
      handlers.set(domain, handler)
    },
    originOf: (domain, host) => servers.get(domain, host).base,
    sourcesOf: (domain, hostList) =>
      hostList === undefined
        ? [ANY_LOOPBACK_PORT]
        : hostList.map((host) => servers.get(domain, host).origin),
    release: servers.release,
    locate: (candidate) => {
      try {
        const url = new URL(candidate)
        const entry = servers.byLoopbackOrigin(url.origin)
        if (!entry || !hasCapability(url.pathname, entry.capability)) return null
        return { domain: entry.domain, host: entry.host, logicalUrl: logicalUrlOf(entry, url) }
      } catch {
        return null
      }
    },
    clearStorage: (origins) => {
      for (const origin of origins) {
        const entry = servers.ofOrigin(origin)
        if (entry) entry.clearStorageOnNextDocument = true
      }
    },
    setDocumentPolicy: (domain, policy) => {
      documentPolicies.set(domain, policy)
    },
  }
}

/** The app's loopback trusted origins; one set of servers per process. */
export const electrobunTrustedOrigins = createLoopbackTrustedOrigins()
