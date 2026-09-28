import type { ToolCall } from '@earendil-works/pi-ai/compat'
import { validateToolArguments } from '@earendil-works/pi-ai/utils/validation'
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import type { McpGatewayInput, McpGatewayResult, McpJsonValue } from '@shared/types/mcp'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import { Type } from 'typebox'
import { expect, type Mock, vi } from 'vitest'
import { registerMcpDirectTools } from '../mcp-direct-tools-extension'
import { isJsonSchemaObject } from '../provider-tool-parameter-schema'
import { compileToolArgumentsValidator } from '../tool-arguments-validator'

export type Outcome =
  | { readonly accepted: true; readonly forwarded: unknown }
  | { readonly accepted: false }

export interface PipelineCase {
  readonly label: string
  readonly schema: McpJsonValue
  readonly arguments_: ToolCall['arguments']
}

export function toolCall(arguments_: ToolCall['arguments']): ToolCall {
  return { type: 'toolCall', id: 'call-1', name: 'mcp_probe', arguments: arguments_ }
}

/** How Pi treats the call when the server's schema is registered directly, unrepaired. */
export function piOnServerSchema(schema: McpJsonValue, arguments_: ToolCall['arguments']): Outcome {
  try {
    const forwarded: unknown = validateToolArguments(
      {
        name: 'mcp_probe',
        description: 'probe',
        parameters: Type.Unsafe<Record<string, unknown>>(fromAny(schema)),
      },
      toolCall(arguments_),
    )
    return { accepted: true, forwarded }
  } catch {
    return { accepted: false }
  }
}

export interface RegisteredProbe {
  readonly definition: ToolDefinition
  readonly executeGateway: Mock<(request: McpGatewayInput) => Promise<McpGatewayResult>>
}

export function register(schema: McpJsonValue): RegisteredProbe {
  const executeGateway = vi.fn(
    async (request: McpGatewayInput): Promise<McpGatewayResult> =>
      request.operation === 'describe'
        ? {
            operation: 'describe',
            text: 'described',
            tools: [{ handle: 'probe', title: 'probe', inputSchema: { type: 'object' } }],
            attribution: { serverInstanceId: 'probe', serverLabel: 'Probe', toolName: 'probe' },
          }
        : { operation: 'call', text: 'completed', result: { ok: true } },
  )
  let definition: ToolDefinition | undefined
  registerMcpDirectTools(
    fromPartial<ExtensionAPI>({
      registerTool: (tool: ToolDefinition) => {
        definition = tool
      },
    }),
    [
      {
        modelName: 'mcp_probe',
        handle: 'probe',
        title: 'probe',
        serverLabel: 'Probe',
        inputSchema: schema,
      },
    ],
    executeGateway,
  )
  if (!definition) throw new Error('mcp_probe was not registered')
  return { definition, executeGateway }
}

/** The agent loop's path: Pi validates against the registered parameters, then runs `execute`. */
export async function throughRepairedTool(
  schema: McpJsonValue,
  arguments_: ToolCall['arguments'],
): Promise<Outcome> {
  const { definition, executeGateway } = register(schema)
  const ctx = fromPartial<ExtensionContext>({ hasUI: true, ui: { confirm: async () => true } })
  try {
    const validated: Record<string, unknown> = validateToolArguments(
      definition,
      toolCall(arguments_),
    )
    await definition.execute('call-1', validated, undefined, undefined, ctx)
  } catch (error) {
    // Rejections must happen before the server is contacted, as Pi's own validation does.
    expect(executeGateway, String(error)).not.toHaveBeenCalled()
    return { accepted: false }
  }
  const call = executeGateway.mock.calls
    .map(([request]) => request)
    .find((request) => request.operation === 'call')
  return { accepted: true, forwarded: call?.operation === 'call' ? call.arguments : undefined }
}

export function serverSchemaAccepts(schema: McpJsonValue, arguments_: unknown) {
  if (!isJsonSchemaObject(schema)) throw new Error('fixture schemas are objects')
  const compiled = compileToolArgumentsValidator(schema)
  if (!('validate' in compiled)) throw new Error(compiled.error)
  return compiled.validate(arguments_).length === 0
}
