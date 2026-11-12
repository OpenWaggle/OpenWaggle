import { safeDecodeUnknown, Schema } from '@shared/schema'
import { mcpConfigValueSchema } from '@shared/schemas/mcp'
import type { JsonObject } from '@shared/types/json'
import type { McpAppDescriptor, McpAppToolCallResult, McpJsonValue } from '@shared/types/mcp'
import { normalizeToolResultPayload } from '@shared/utils/tool-result-state'

export interface McpAppLaunch {
  readonly descriptor: McpAppDescriptor
  readonly initialArguments: Readonly<Record<string, McpJsonValue>>
  readonly initialResult: McpAppToolCallResult
}

const nonEmptyString = Schema.String.pipe(Schema.minLength(1))

const mcpAppDescriptorSchema: Schema.Schema<McpAppDescriptor> = Schema.Struct({
  serverInstanceId: nonEmptyString,
  serverLabel: nonEmptyString,
  serverConfigHash: nonEmptyString,
  toolHandle: nonEmptyString,
  toolName: nonEmptyString,
  toolTitle: nonEmptyString,
  resourceUri: nonEmptyString,
})

/** The `details.mcpApp` OpenWaggle's MCP layer adds to a Pi MCP tool result. */
const mcpAppToolResultPayloadSchema = Schema.Struct({
  details: Schema.Struct({
    mcpApp: Schema.Struct({
      descriptor: mcpAppDescriptorSchema,
      toolResult: Schema.Struct({
        content: mcpConfigValueSchema,
        structuredContent: Schema.optionalWith(mcpConfigValueSchema, { exact: true }),
        // Only `true` marks an error result.
        isError: Schema.optionalWith(Schema.Unknown, { exact: true }),
      }),
    }),
  }),
})

function json(value: unknown) {
  const decoded = safeDecodeUnknown(mcpConfigValueSchema, value)
  return decoded.success ? decoded.data : null
}

function argumentsFromToolCall(args: JsonObject) {
  const value = json(args)
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/**
 * The MCP App a tool result opens. OpenWaggle's MCP layer adds `details.mcpApp` to the result of
 * a Pi MCP tool (`mcp__<server>__<tool>`) whose tool names a `ui://` resource.
 */
export function getMcpAppLaunch(content: unknown, args: JsonObject) {
  const decoded = safeDecodeUnknown(
    mcpAppToolResultPayloadSchema,
    normalizeToolResultPayload(content),
  )
  if (!decoded.success) return null
  const { descriptor, toolResult } = decoded.data.details.mcpApp
  const launch: McpAppLaunch | null = {
    descriptor,
    initialArguments: argumentsFromToolCall(args),
    initialResult: {
      content: toolResult.content,
      ...(toolResult.structuredContent === undefined
        ? {}
        : { structuredContent: toolResult.structuredContent }),
      isError: toolResult.isError === true,
      attribution: {
        serverInstanceId: descriptor.serverInstanceId,
        serverLabel: descriptor.serverLabel,
        toolName: descriptor.toolName,
      },
    },
  }
  return launch
}
