import * as Effect from 'effect/Effect'

/**
 * MCP Apps read their `ui://` resources and call their tools through Pi's MCP runtime (ADR 0048).
 * OpenWaggle's own client is gone and the transport layer that replaces it is not wired in yet,
 * so both operations fail with a message the MCP App host can show.
 */
export const MCP_APPS_UNAVAILABLE_MESSAGE =
  "MCP Apps are moving to Pi's MCP runtime and are unavailable in this build."

function mcpAppsUnavailable() {
  return Effect.fail(new Error(MCP_APPS_UNAVAILABLE_MESSAGE))
}

export function readMcpResourceOperation(_raw: unknown) {
  return mcpAppsUnavailable()
}

export function callMcpAppToolOperation(_raw: unknown) {
  return mcpAppsUnavailable()
}
