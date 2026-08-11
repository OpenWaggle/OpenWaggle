import { createHash } from 'node:crypto'
import type { McpDirectToolDescriptor, McpTurnSnapshot } from '@shared/types/mcp'
import type { CatalogTool, McpRuntimeState } from './runtime-state'

const MODEL_TOOL_NAME_MAX_LENGTH = 64
const IDENTITY_SUFFIX_LENGTH = 8

function requestedDirectTool(tool: CatalogTool) {
  const selection = tool.server.definition.directTools
  return selection === true || (Array.isArray(selection) && selection.includes(tool.tool.name))
}

function slug(value: string) {
  const normalized = value.toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, '_')
  return normalized.replace(/^_+|_+$/g, '') || 'tool'
}

function modelName(tool: CatalogTool) {
  const suffix = createHash('sha256')
    .update(`${tool.server.instanceId}\0${tool.tool.name}`)
    .digest('hex')
    .slice(0, IDENTITY_SUFFIX_LENGTH)
  const prefix = `mcp_${slug(tool.server.name)}_${slug(tool.tool.name)}`
  return `${prefix.slice(0, MODEL_TOOL_NAME_MAX_LENGTH - suffix.length - 1)}_${suffix}`
}

function toDescriptor(tool: CatalogTool): McpDirectToolDescriptor {
  return {
    modelName: modelName(tool),
    handle: tool.handle,
    title: tool.tool.title ?? tool.tool.name,
    ...(tool.tool.description ? { description: tool.tool.description } : {}),
    ...(tool.tool.inputSchema ? { inputSchema: tool.tool.inputSchema } : {}),
    serverLabel: tool.server.name,
  }
}

export async function listMcpDirectTools(state: McpRuntimeState, snapshot: McpTurnSnapshot) {
  if (snapshot.effectiveState !== 'on') return []
  const catalog = await state.loadCatalog(
    snapshot,
    (server) =>
      server.definition.directTools === true ||
      (Array.isArray(server.definition.directTools) && server.definition.directTools.length > 0),
  )
  const descriptors: McpDirectToolDescriptor[] = []
  for (const tool of catalog) {
    if (requestedDirectTool(tool)) descriptors.push(toDescriptor(tool))
  }
  return descriptors
}
