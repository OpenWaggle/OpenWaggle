import type { McpServerExposure } from '@shared/types/mcp-configuration'

/**
 * How OpenWaggle runs MCP exposure (ADR 0051 amendment, v1 performance). Pi's files keep Pi's
 * four exposures, and the `pi` command still reads `direct` as direct. OpenWaggle runs `direct`
 * as `codemode`, so a server no longer puts every tool schema into each request; tools that open
 * an MCP App stay declared to the model (`mcp-openwaggle-exposure.ts` in the main process).
 */

/** An exposure as OpenWaggle runs it. */
export type McpRuntimeExposure = Exclude<McpServerExposure, 'direct'>

/** The exposures Settings > MCP offers. A file's `direct` shows as `codemode`. */
export const MCP_SETTINGS_EXPOSURE_CHOICES = [
  'codemode',
  'hidden',
] as const satisfies readonly McpRuntimeExposure[]

/** The exposure OpenWaggle runs for a configured one: `direct` runs as `codemode`. */
export function openWaggleMcpExposure(exposure: McpServerExposure): McpRuntimeExposure {
  return exposure === 'direct' ? 'codemode' : exposure
}
