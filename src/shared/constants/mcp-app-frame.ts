/**
 * The protocol MCP App frames load from. A `srcdoc` frame inherits the page's own CSP, which
 * allows no scripts from the network, so an App could never load the code its server hosts; each
 * App document is served from its own `frame-<uuid>` host with a policy of its own (ADR 0053).
 */
export const MCP_APP_FRAME_PROTOCOL = {
  SCHEME: 'openwaggle-mcp-app',
  FRAME_HOST_PREFIX: 'frame-',
  DOCUMENT_PATH: '/document',
} as const

/** The largest App document the Host serves. Real Apps are a few KB of HTML that load code. */
export const MAX_MCP_APP_DOCUMENT_BYTES = 4 * 1024 * 1024
/** At most this many App documents one renderer has registered at once. */
export const MAX_MCP_APP_FRAMES_PER_RENDERER = 32
/** At most this many origins per CSP directive an App declares. */
export const MAX_MCP_APP_DECLARED_ORIGINS = 64
