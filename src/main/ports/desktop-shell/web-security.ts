import { Context } from 'effect'
import type { RendererSurface } from './renderer-surfaces'

/**
 * Web-engine security the shell applies to the app's own pages (ADR 0064). The policy itself is
 * OpenWaggle's (`src/main/security/`, `renderer-document-trust.ts`); adapters only apply it:
 * - the main window's page gets the app's Content Security Policy on every response of its own
 *   origin, media permissions only for the trusted renderer origin (none under automation), and
 *   navigations to untrusted documents or new windows go to the system browser instead;
 * - inline visualization and MCP App frames may only navigate within themselves;
 * - pages of every surface run sandboxed, context-isolated and without Node.
 *
 * The Electron adapter applies it through `session.webRequest`, permission handlers and
 * `will-navigate`.
 */
/** What pages stored in one web profile; it stays usable after the surface it came from closes. */
export interface OriginStorage {
  /** Deletes what pages of `origins` stored: cookies, IndexedDB, local storage. Never fails. */
  readonly clear: (origins: readonly string[]) => void
}

export interface WebSecurityShape {
  /**
   * Confines the inline visualization and MCP App frames of `surface` (call once per page).
   * Throws when the shell has no page for `surface`, so a missing page never runs unguarded.
   */
  readonly guardEmbeddedFrames: (surface: RendererSurface) => void
  /** The storage of `surface`'s web profile; take it while the surface is open. */
  readonly originStorageOf: (surface: RendererSurface) => OriginStorage
  /** Keeps the app profile's web caches within their caps, now and while the app runs. */
  readonly maintainCaches: () => void
}

export class WebSecurity extends Context.Tag('@openwaggle/WebSecurity')<
  WebSecurity,
  WebSecurityShape
>() {}
