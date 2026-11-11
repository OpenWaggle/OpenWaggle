import type { TrustedOriginDomain } from '../../ports/desktop-shell/trusted-origins'
import type { WebSecurityShape } from '../../ports/desktop-shell/web-security'
import {
  buildContentSecurityPolicy,
  type RendererPolicySources,
} from '../../security/web-security-policy'
import {
  type ElectrobunTrustedOrigins,
  electrobunTrustedOrigins,
} from './electrobun-trusted-origins'

/**
 * Electrobun's web security (ADR 0064). The system webviews have no request interception, no
 * per-frame navigation hook and no per-origin storage API, so the policy lives where Electrobun can
 * enforce it:
 *
 * - The renderer's Content Security Policy is a response header of the renderer's loopback server
 *   (`rendererDocumentHeaders`), with the trusted origins' loopback sources and the loopback socket
 *   of the page's RPC (`ws://127.0.0.1:*`). A Vite dev server's pages get no policy.
 * - Embedded frames are confined by that policy's `frame-src`, which names only the trusted
 *   origins, and by each frame host's capability path, so a frame reaches neither the internet
 *   nor another frame's documents. Electrobun's `navigationRules` only see the main frame (macOS
 *   `shouldApplyMainFrameNavigationRules`), so `guardEmbeddedFrames` has nothing to install. What
 *   remains open: `frame-src http://127.0.0.1:*` lets a frame navigate itself to another local
 *   HTTP server, a GET with no credentials of ours.
 * - Origin storage is cleared by the frame host's server: its next document carries
 *   `Clear-Site-Data: "storage"` (`ElectrobunTrustedOrigins.clearStorage`), and a host on a fresh
 *   port clears on its first document, so a reused port never inherits another frame's storage.
 * - Web caches stay with the system webview (WebKit's and WebView2's own size limits); there is no
 *   Chromium disk cache to cap, so `maintainCaches` does nothing.
 */
export const RPC_SOCKET_SOURCE = 'ws://127.0.0.1:*'

/** The renderer policy's sources for the Electrobun shell's trusted origins. */
export function electrobunRendererPolicySources(
  origins: Pick<ElectrobunTrustedOrigins, 'sourcesOf'> = electrobunTrustedOrigins,
): RendererPolicySources {
  const sourcesOf = (domain: TrustedOriginDomain) => origins.sourcesOf(domain)
  return {
    extensionRuntime: sourcesOf('extension-runtime'),
    sessionResource: sourcesOf('session-resource'),
    extensionFrame: sourcesOf('extension-frame'),
    inlineVisualization: sourcesOf('inline-visualization'),
    mcpAppFrame: sourcesOf('mcp-app-frame'),
    connect: [RPC_SOCKET_SOURCE],
  }
}

/** The headers of every renderer document: the app's Content Security Policy. */
export function rendererDocumentHeaders(
  origins: Pick<ElectrobunTrustedOrigins, 'sourcesOf'> = electrobunTrustedOrigins,
): HeadersInit {
  return {
    'content-security-policy': buildContentSecurityPolicy(electrobunRendererPolicySources(origins)),
  }
}

export function createElectrobunWebSecurity(
  origins: Pick<ElectrobunTrustedOrigins, 'clearStorage'> = electrobunTrustedOrigins,
): WebSecurityShape {
  // Storage belongs to the frame hosts' servers, not to the page that asked: the handle works
  // whether or not the page is still open.
  const storage = { clear: (list: readonly string[]) => origins.clearStorage(list) }
  return {
    guardEmbeddedFrames: () => undefined,
    originStorageOf: () => storage,
    maintainCaches: () => undefined,
  }
}

export const electrobunWebSecurity = createElectrobunWebSecurity()
