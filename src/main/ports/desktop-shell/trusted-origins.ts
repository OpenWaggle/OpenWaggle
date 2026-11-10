import { Context } from 'effect'

/**
 * One trust domain the app serves its own content from (ADR 0064). Each domain is a separate web
 * origin, so a page of one can never script or read another:
 * - `renderer`: the app's own page and its assets;
 * - `extension-runtime`: extension UI modules the renderer imports;
 * - `extension-frame`: each extension's sandboxed frame (one host per extension);
 * - `inline-visualization`: each inline visualization document (one host per document);
 * - `mcp-app-frame`: each MCP App document (one host per frame, ADR 0053);
 * - `session-resource`: Session images and files the renderer displays.
 *
 * Electron serves a privileged custom scheme per domain (`TRUSTED_ORIGIN_SCHEMES`) through
 * `protocol.handle`. Electrobun
 * serves a `Bun.serve` origin per domain on `127.0.0.1` that requires a per-launch token.
 */
export type TrustedOriginDomain =
  | 'renderer'
  | 'extension-runtime'
  | 'extension-frame'
  | 'inline-visualization'
  | 'mcp-app-frame'
  | 'session-resource'

export interface TrustedOriginDeclaration {
  readonly domain: TrustedOriginDomain
  /** Pages of other origins may `fetch` it with CORS. */
  readonly corsEnabled: boolean
  /** The engine may keep compiled script for it between launches (A-F11). */
  readonly codeCache: boolean
}

/** Answers one request to a trusted origin, as a server would. */
export type TrustedOriginHandler = (request: Request) => Response | Promise<Response>

export interface TrustedOriginsShape {
  /**
   * Declares every domain the app will serve, once, before the app is ready. A secure,
   * standard origin with Fetch API support is what each domain gets.
   */
  readonly declare: (declarations: readonly TrustedOriginDeclaration[]) => void
  /** Serves a declared domain: from now on every request to it reaches `handler`. */
  readonly serve: (domain: TrustedOriginDomain, handler: TrustedOriginHandler) => void
  /** The origin (`scheme://host`) of `host` in a declared domain, as pages address it. */
  readonly originOf: (domain: TrustedOriginDomain, host: string) => string
}

export class TrustedOrigins extends Context.Tag('@openwaggle/TrustedOrigins')<
  TrustedOrigins,
  TrustedOriginsShape
>() {}
