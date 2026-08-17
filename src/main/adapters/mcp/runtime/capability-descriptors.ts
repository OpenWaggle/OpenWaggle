import type {
  McpAppDescriptor,
  McpJsonValue,
  McpPromptDescriptor,
  McpResourceDescriptor,
  McpResourceTemplateDescriptor,
  McpTurnSnapshotServer,
} from '@shared/types/mcp'
import type { CatalogTool } from './runtime-state'

function isObject(value: McpJsonValue | undefined): value is Record<string, McpJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: Record<string, McpJsonValue>, key: string) {
  return typeof value[key] === 'string' ? value[key] : undefined
}

export function promptDescriptor(
  value: McpJsonValue,
  server: McpTurnSnapshotServer,
): McpPromptDescriptor | null {
  if (!isObject(value) || typeof value.name !== 'string') return null
  const arguments_ = Array.isArray(value.arguments)
    ? value.arguments.flatMap((argument) => {
        if (!isObject(argument) || typeof argument.name !== 'string') return []
        return [
          {
            name: argument.name,
            ...(typeof argument.description === 'string'
              ? { description: argument.description }
              : {}),
            required: argument.required === true,
          },
        ]
      })
    : []
  return {
    serverInstanceId: server.instanceId,
    serverLabel: server.name,
    name: value.name,
    ...(optionalString(value, 'title') ? { title: optionalString(value, 'title') } : {}),
    ...(optionalString(value, 'description')
      ? { description: optionalString(value, 'description') }
      : {}),
    arguments: arguments_,
  }
}

export function resourceDescriptor(
  value: McpJsonValue,
  server: McpTurnSnapshotServer,
): McpResourceDescriptor | null {
  if (!isObject(value) || typeof value.uri !== 'string' || typeof value.name !== 'string') {
    return null
  }
  return {
    serverInstanceId: server.instanceId,
    serverLabel: server.name,
    uri: value.uri,
    name: value.name,
    ...(optionalString(value, 'title') ? { title: optionalString(value, 'title') } : {}),
    ...(optionalString(value, 'description')
      ? { description: optionalString(value, 'description') }
      : {}),
    ...(optionalString(value, 'mimeType') ? { mimeType: optionalString(value, 'mimeType') } : {}),
    ...(typeof value.size === 'number' ? { size: value.size } : {}),
  }
}

export function templateDescriptor(
  value: McpJsonValue,
  server: McpTurnSnapshotServer,
): McpResourceTemplateDescriptor | null {
  if (!isObject(value) || typeof value.uriTemplate !== 'string' || typeof value.name !== 'string') {
    return null
  }
  return {
    serverInstanceId: server.instanceId,
    serverLabel: server.name,
    uriTemplate: value.uriTemplate,
    name: value.name,
    ...(optionalString(value, 'title') ? { title: optionalString(value, 'title') } : {}),
    ...(optionalString(value, 'description')
      ? { description: optionalString(value, 'description') }
      : {}),
    ...(optionalString(value, 'mimeType') ? { mimeType: optionalString(value, 'mimeType') } : {}),
  }
}

export function appResourceUri(tool: CatalogTool) {
  if (!isObject(tool.tool.meta)) return null
  const nestedUi = tool.tool.meta.ui
  if (isObject(nestedUi) && typeof nestedUi.resourceUri === 'string') return nestedUi.resourceUri
  const legacy = tool.tool.meta['ui/resourceUri']
  return typeof legacy === 'string' ? legacy : null
}

export function appDescriptor(tool: CatalogTool): McpAppDescriptor | null {
  const resourceUri = appResourceUri(tool)
  if (!resourceUri?.startsWith('ui://')) return null
  return {
    serverInstanceId: tool.server.instanceId,
    serverLabel: tool.server.name,
    toolHandle: tool.handle,
    toolName: tool.tool.name,
    toolTitle: tool.tool.title ?? tool.tool.name,
    resourceUri,
    allowedNetworkDomains: tool.server.definition.security?.networkDomains ?? [],
  }
}
