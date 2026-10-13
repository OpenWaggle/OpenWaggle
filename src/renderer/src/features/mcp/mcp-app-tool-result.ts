import { safeDecodeUnknown } from '@shared/schema'
import { mcpConfigValueSchema } from '@shared/schemas/mcp'
import type { JsonObject } from '@shared/types/json'
import type { McpAppDescriptor, McpAppToolCallResult, McpJsonValue } from '@shared/types/mcp'
import { normalizeToolResultPayload } from '@shared/utils/tool-result-state'
import { isRecord } from '@shared/utils/validation'

export interface McpAppLaunch {
  readonly descriptor: McpAppDescriptor
  readonly initialArguments: Readonly<Record<string, McpJsonValue>>
  readonly initialResult: McpAppToolCallResult
}

function string(value: unknown) {
  return typeof value === 'string' ? value : null
}

function descriptor(value: unknown): McpAppDescriptor | null {
  if (!isRecord(value)) return null
  const serverInstanceId = string(value.serverInstanceId)
  const serverLabel = string(value.serverLabel)
  const serverConfigHash = string(value.serverConfigHash)
  const toolHandle = string(value.toolHandle)
  const toolName = string(value.toolName)
  const toolTitle = string(value.toolTitle)
  const resourceUri = string(value.resourceUri)
  if (
    !serverInstanceId ||
    !serverLabel ||
    !serverConfigHash ||
    !toolHandle ||
    !toolName ||
    !toolTitle ||
    !resourceUri
  ) {
    return null
  }
  const allowedNetworkDomains = Array.isArray(value.allowedNetworkDomains)
    ? value.allowedNetworkDomains.filter((entry): entry is string => typeof entry === 'string')
    : []
  return {
    serverInstanceId,
    serverLabel,
    serverConfigHash,
    toolHandle,
    toolName,
    toolTitle,
    resourceUri,
    allowedNetworkDomains,
  }
}

function json(value: unknown) {
  const decoded = safeDecodeUnknown(mcpConfigValueSchema, value)
  return decoded.success ? decoded.data : null
}

function result(value: unknown, app: McpAppDescriptor): McpAppToolCallResult | null {
  if (!isRecord(value)) return null
  const content = json(value.content)
  if (content === null) return null
  const structuredContent =
    value.structuredContent === undefined ? undefined : json(value.structuredContent)
  if (value.structuredContent !== undefined && structuredContent === null) return null
  return {
    content,
    ...(structuredContent === undefined ? {} : { structuredContent }),
    isError: value.isError === true,
    attribution: {
      serverInstanceId: app.serverInstanceId,
      serverLabel: app.serverLabel,
      toolName: app.toolName,
    },
  }
}

function argumentsFromToolCall(args: JsonObject) {
  const value = json(args)
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/**
 * The MCP App a tool result opens. OpenWaggle's MCP layer adds `details.mcpApp` to the result of
 * a Pi MCP tool (`mcp__<server>__<tool>`) whose tool names a `ui://` resource.
 */
export function getMcpAppLaunch(content: unknown, args: JsonObject): McpAppLaunch | null {
  const payload = normalizeToolResultPayload(content)
  if (!isRecord(payload) || !isRecord(payload.details) || !isRecord(payload.details.mcpApp)) {
    return null
  }
  const mcpApp = payload.details.mcpApp
  const app = descriptor(mcpApp.descriptor)
  if (!app) return null
  const initialResult = result(mcpApp.toolResult, app)
  if (!initialResult) return null
  return { descriptor: app, initialArguments: argumentsFromToolCall(args), initialResult }
}
