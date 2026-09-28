import type { ToolCall } from '@earendil-works/pi-ai/compat'
import { validateToolArguments } from '@earendil-works/pi-ai/utils/validation'
import type { McpDirectToolDescriptor } from '@shared/types/mcp'
import type { TUnsafe } from 'typebox'
import { toJsonObject } from './pi-message-mapper'
import { isJsonSchemaObject } from './provider-tool-parameter-schema'
import type { ToolArgumentsValidator } from './tool-arguments-validator'

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

/** The arguments Pi would hand `execute` for `parameters`, or `undefined` when Pi rejects them. */
function piCleanedArguments(
  tool: McpDirectToolDescriptor,
  parameters: ToolParameters,
  arguments_: Record<string, unknown>,
) {
  const toolCall: ToolCall = {
    type: 'toolCall',
    id: 'mcp-call-time-validation',
    name: tool.modelName,
    // Tool-call arguments are parsed JSON, so the JSON conversion keeps every value.
    arguments: toJsonObject(arguments_),
  }
  let validated: unknown
  try {
    validated = validateToolArguments(
      { name: tool.modelName, description: tool.title, parameters },
      toolCall,
    )
  } catch {
    return undefined
  }
  if (!isJsonSchemaObject(validated)) {
    throw new Error(`Pi returned non-object arguments for MCP tool ${tool.title}.`)
  }
  return { ...validated }
}

/**
 * Returns the arguments to forward for a repaired direct tool, or throws a model-readable error.
 *
 * The provider-facing schema is relaxed, so Pi's own clean-up (dropping optional `null`s,
 * coercing `'5'` to `5`) has not happened yet. In order, forward:
 * 1. what Pi accepts against the server's schema, as Pi cleaned it;
 * 2. what Pi's coercion through the flattened repair turns into arguments the server's
 *    schema accepts exactly;
 * 3. the arguments as sent, when the server's schema accepts them exactly.
 */
export function mcpDirectToolCallArguments(
  tool: McpDirectToolDescriptor,
  validation: McpDirectToolCallValidation,
  arguments_: Record<string, unknown>,
): Record<string, unknown> {
  const cleaned = piCleanedArguments(tool, validation.server, arguments_)
  if (cleaned) return cleaned
  const coerced = piCleanedArguments(tool, validation.flattened, arguments_)
  if (coerced && validation.validate(coerced).length === 0) return coerced
  const invalid = validation.validate(arguments_)
  if (invalid.length === 0) return arguments_
  throw new Error(`Invalid arguments for MCP tool ${tool.title}: ${invalid.join('; ')}`)
}
