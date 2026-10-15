/**
 * What an Agent definition's `tools` allowlist lets a Run call. Entries are Pi tool names. MCP
 * tools are named as Pi names them, `mcp__<namespace>__<tool>`, where `*` in the tool part
 * matches any characters. The legacy entries `mcp` and `mcp_run` (OpenWaggle's former gateway)
 * keep working and mean every MCP tool of the definition's `mcpServers`, or of every server when
 * it lists none. Naming any MCP tool also allows the Pi tools that reach MCP tools (codemode,
 * tool search, and the resource tools); a codemode child call still has to be allowed itself.
 */
import { MCP_SERVER_REACH_TOOL_NAMES } from '@shared/utils/mcp-tool-names'
import { mcpNamespace } from '../mcp/config/mcp-server-config'

export const LEGACY_AGENT_MCP_TOOL_NAMES = ['mcp', 'mcp_run'] as const

/** Pi's tools through which the model reaches MCP tools. */
export const MCP_REACH_TOOL_NAMES = ['codemode', ...MCP_SERVER_REACH_TOOL_NAMES] as const

const MCP_TOOL_REFERENCE = /^mcp__[A-Za-z0-9_]+__.+$/

function isLegacyMcpReference(reference: string) {
  return LEGACY_AGENT_MCP_TOOL_NAMES.some((name) => name === reference)
}

/** True for `mcp`, `mcp_run`, and `mcp__<namespace>__<tool or pattern>` entries. */
export function isAgentMcpToolReference(reference: string) {
  return isLegacyMcpReference(reference) || MCP_TOOL_REFERENCE.test(reference)
}

/** The namespace (`mcp__<server>`) an `mcp__…` reference names; undefined for legacy entries. */
export function agentMcpToolReferenceNamespace(reference: string) {
  if (!MCP_TOOL_REFERENCE.test(reference)) return undefined
  const separator = reference.indexOf('__', 'mcp__'.length)
  return reference.slice(0, separator)
}

function patternRegExp(pattern: string) {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}$`)
}

function mcpPatterns(reference: string, mcpServers: readonly string[] | undefined) {
  if (!isLegacyMcpReference(reference)) return [patternRegExp(reference)]
  if (!mcpServers) return [/^mcp__.+__.+$/]
  return mcpServers.map((server) => patternRegExp(`${mcpNamespace(server)}__*`))
}

export function agentToolAllowlist(input: {
  readonly tools: readonly string[]
  readonly mcpServers?: readonly string[]
}): (toolName: string) => boolean {
  const exact = new Set(input.tools.filter((tool) => !isAgentMcpToolReference(tool)))
  const mcp = input.tools.filter(isAgentMcpToolReference)
  const patterns = mcp.flatMap((reference) => mcpPatterns(reference, input.mcpServers))
  if (mcp.length > 0) for (const tool of MCP_REACH_TOOL_NAMES) exact.add(tool)
  return (toolName) => exact.has(toolName) || patterns.some((pattern) => pattern.test(toolName))
}
