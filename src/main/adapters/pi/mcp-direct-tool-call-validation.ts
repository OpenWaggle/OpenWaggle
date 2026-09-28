import type { ToolCall } from '@earendil-works/pi-ai/compat'
import { validateToolArguments } from '@earendil-works/pi-ai/utils/validation'
import type { McpDirectToolDescriptor } from '@shared/types/mcp'
import type { TUnsafe } from 'typebox'
import { toJsonObject } from './pi-message-mapper'
import { isJsonSchemaObject, type ToolArgumentsValidator } from './provider-tool-parameter-schema'

type ToolParameters = TUnsafe<Record<string, unknown>>

/** What a repaired direct tool checks when it runs, before the user is asked to approve it. */
export interface McpDirectToolCallValidation {
  /** The server's own schema. */
  readonly server: ToolParameters
  /** The flattened, unrelaxed repair: its property types let Pi coerce what the server rejects raw. */
  readonly flattened: ToolParameters
  /** Exact check against the server's schema, without coercion. */
  readonly validate: ToolArgumentsValidator
}

type PiValidation =
  | { readonly ok: true; readonly arguments: Record<string, unknown> }
  | { readonly ok: false; readonly details: string }

const PI_VALIDATION_DETAIL = /^\s+- (.+)$/u

function piValidation(
  tool: McpDirectToolDescriptor,
  parameters: ToolParameters,
  arguments_: Record<string, unknown>,
): PiValidation {
  const toolCall: ToolCall = {
    type: 'toolCall',
    id: 'mcp-call-time-validation',
    name: tool.modelName,
    // Tool-call arguments arrive as parsed JSON, so this conversion is lossless.
    arguments: toJsonObject(arguments_),
  }
  try {
    const validated: unknown = validateToolArguments(
      { name: tool.modelName, description: tool.title, parameters },
      toolCall,
    )
    return { ok: true, arguments: isJsonSchemaObject(validated) ? { ...validated } : arguments_ }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const details = message.split('\n').flatMap((line) => {
      const detail = PI_VALIDATION_DETAIL.exec(line)?.[1]
      return detail === undefined ? [] : [detail]
    })
    return { ok: false, details: details.length > 0 ? details.join('; ') : message }
  }
}

/**
 * Returns the arguments to forward for a repaired direct tool, or throws a model-readable error.
 *
 * The provider-facing schema is relaxed, so Pi's own clean-up (dropping optional `null`s,
 * coercing `'5'` to `5`) has not happened yet. Accept what Pi accepts against the server's
 * schema, forwarding its cleaned arguments; otherwise accept what Pi's coercion through the
 * flattened repair turns into arguments the server's schema accepts exactly.
 */
export function mcpDirectToolCallArguments(
  tool: McpDirectToolDescriptor,
  validation: McpDirectToolCallValidation,
  arguments_: Record<string, unknown>,
): Record<string, unknown> {
  const server = piValidation(tool, validation.server, arguments_)
  if (server.ok) return server.arguments
  const coerced = piValidation(tool, validation.flattened, arguments_)
  if (coerced.ok && validation.validate(coerced.arguments).length === 0) return coerced.arguments
  throw new Error(`Invalid arguments for MCP tool ${tool.title}: ${server.details}`)
}
