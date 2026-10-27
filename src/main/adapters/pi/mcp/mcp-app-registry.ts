import type { McpAppDescriptor } from '@shared/types/mcp-apps'
import { isRecord } from '@shared/utils/validation'

/**
 * The MCP App tools each Session's servers offer, learned from the `tools/list` results that pass
 * through the transport layer (Pi drops a tool's `_meta`, where the App's `ui://` resource is
 * named). Kept per Session and server and replaced by every listing.
 */
interface McpAppTool {
  readonly name: string
  readonly title?: string
  readonly resourceUri: string
}

const registry = new Map<string, ReadonlyMap<string, McpAppTool>>()
/** Whether each listed tool may be called by an App (MCP Apps `_meta.ui.visibility`). */
const appVisibility = new Map<string, ReadonlyMap<string, boolean>>()

function key(sessionId: string, serverName: string) {
  return `${sessionId}\u0000${serverName}`
}

/** A tool's `ui://` resource: `_meta.ui.resourceUri`, or the older `_meta["ui/resourceUri"]`. */
function appResourceUri(tool: Record<string, unknown>) {
  if (!isRecord(tool._meta)) return undefined
  const ui = tool._meta.ui
  const uri = isRecord(ui) ? ui.resourceUri : tool._meta['ui/resourceUri']
  return typeof uri === 'string' && uri.startsWith('ui://') ? uri : undefined
}

/** MCP Apps `_meta.ui.visibility`: absent means the model and apps; a list names who may see it. */
function visibleToApps(tool: Record<string, unknown>) {
  const ui = isRecord(tool._meta) ? tool._meta.ui : undefined
  const visibility = isRecord(ui) ? ui.visibility : undefined
  return !Array.isArray(visibility) || visibility.includes('app')
}

/** Whether an App may call a tool its server listed; undefined when it was not listed. */
export function mcpToolVisibleToApps(sessionId: string, serverName: string, toolName: string) {
  return appVisibility.get(key(sessionId, serverName))?.get(toolName)
}

/** Records the visibility of the tools in a `tools/list` result page. */
export function recordMcpToolVisibility(sessionId: string, serverName: string, result: unknown) {
  if (!isRecord(result) || !Array.isArray(result.tools)) return
  const visibility = new Map(appVisibility.get(key(sessionId, serverName)))
  for (const tool of result.tools) {
    if (isRecord(tool) && typeof tool.name === 'string')
      visibility.set(tool.name, visibleToApps(tool))
  }
  appVisibility.set(key(sessionId, serverName), visibility)
}

/** The names of the App tools in one `tools/list` result page. */
export function mcpAppToolNamesOf(result: unknown) {
  if (!isRecord(result) || !Array.isArray(result.tools)) return []
  return result.tools.flatMap((tool) =>
    isRecord(tool) && typeof tool.name === 'string' && appResourceUri(tool) ? [tool.name] : [],
  )
}

/** Records the App tools in one `tools/list` result page. */
export function recordMcpAppTools(sessionId: string, serverName: string, result: unknown) {
  if (!isRecord(result) || !Array.isArray(result.tools)) return
  const tools = new Map(registry.get(key(sessionId, serverName)))
  for (const tool of result.tools) {
    if (!isRecord(tool) || typeof tool.name !== 'string') continue
    const resourceUri = appResourceUri(tool)
    if (!resourceUri) {
      tools.delete(tool.name)
      continue
    }
    tools.set(tool.name, {
      name: tool.name,
      ...(typeof tool.title === 'string' ? { title: tool.title } : {}),
      resourceUri,
    })
  }
  registry.set(key(sessionId, serverName), tools)
  recordMcpToolVisibility(sessionId, serverName, result)
}

/** The App tools a server listed in this Session; undefined when it has not listed its tools. */
export function mcpAppToolNames(sessionId: string, serverName: string) {
  const tools = registry.get(key(sessionId, serverName))
  return tools ? [...tools.keys()] : undefined
}

export function mcpAppTool(sessionId: string, serverName: string, toolName: string) {
  return registry.get(key(sessionId, serverName))?.get(toolName)
}

/** The descriptor the renderer's MCP App host opens for a tool result. */
export function mcpAppDescriptor(input: {
  readonly sessionId: string
  readonly serverName: string
  readonly serverIdentity: string
  readonly toolName: string
  readonly piToolName: string
}): McpAppDescriptor | undefined {
  const tool = mcpAppTool(input.sessionId, input.serverName, input.toolName)
  if (!tool) return undefined
  return {
    // The Session's server name routes App requests; the identity refuses a replaced server.
    serverInstanceId: input.serverName,
    serverLabel: input.serverName,
    serverConfigHash: input.serverIdentity,
    toolHandle: input.piToolName,
    toolName: tool.name,
    toolTitle: tool.title ?? tool.name,
    resourceUri: tool.resourceUri,
  }
}

export function forgetMcpAppTools(sessionId: string) {
  for (const entry of [...registry.keys()]) {
    if (entry.startsWith(`${sessionId}\u0000`)) registry.delete(entry)
  }
  for (const entry of [...appVisibility.keys()]) {
    if (entry.startsWith(`${sessionId}\u0000`)) appVisibility.delete(entry)
  }
}
