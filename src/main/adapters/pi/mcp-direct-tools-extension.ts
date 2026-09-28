import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { McpDirectToolDescriptor } from '@shared/types/mcp'
import { Type } from 'typebox'
import { createLogger } from '../../logger'
import { type ExecuteGateway, executeApprovedCall, textResult } from './mcp-tool-execution'
import {
  compileToolArgumentsValidator,
  isJsonSchemaObject,
  providerToolParameters,
  type ToolArgumentsValidator,
} from './provider-tool-parameter-schema'

const logger = createLogger('mcp-direct-tools')

interface PreparedParameters {
  readonly parameters: ReturnType<typeof Type.Unsafe<Record<string, unknown>>>
  /** Present when the provider-facing schema is looser than the server's own schema. */
  readonly validate?: ToolArgumentsValidator
  readonly repairs: readonly string[]
  readonly validationUnavailable?: string
}

/**
 * MCP servers publish arbitrary JSON Schema, but Bedrock and OpenAI reject tools whose parameter
 * root is not an object (a root union, `$ref`, missing `type`, ...). Hand Pi a provider-valid
 * object schema and keep the server's schema to validate the real arguments at call time.
 */
function prepareParameters(tool: McpDirectToolDescriptor): PreparedParameters {
  const normalized = providerToolParameters(tool.inputSchema)
  const parameters = Type.Unsafe<Record<string, unknown>>(normalized.schema)
  if (normalized.repairs.length === 0 || !isJsonSchemaObject(tool.inputSchema)) {
    return { parameters, repairs: normalized.repairs }
  }
  const compiled = compileToolArgumentsValidator(tool.inputSchema)
  return 'validate' in compiled
    ? { parameters, repairs: normalized.repairs, validate: compiled.validate }
    : { parameters, repairs: normalized.repairs, validationUnavailable: compiled.error }
}

function logRepairs(prepared: readonly (readonly [McpDirectToolDescriptor, PreparedParameters])[]) {
  const repaired = prepared.flatMap(([tool, parameters]) =>
    parameters.repairs.length > 0
      ? [
          {
            server: tool.serverLabel,
            tool: tool.title,
            modelName: tool.modelName,
            repairs: parameters.repairs,
            callTimeValidation: parameters.validate
              ? 'server schema'
              : (parameters.validationUnavailable ?? 'not needed'),
          },
        ]
      : [],
  )
  if (repaired.length === 0) return
  logger.warn('Normalized MCP tool input schemas that model providers would reject', {
    tools: repaired,
  })
}

export function registerMcpDirectTools(
  pi: ExtensionAPI,
  tools: readonly McpDirectToolDescriptor[],
  executeGateway: ExecuteGateway,
) {
  const prepared = tools.map((tool) => [tool, prepareParameters(tool)] as const)
  logRepairs(prepared)
  for (const [tool, { parameters, validate }] of prepared) {
    pi.registerTool({
      name: tool.modelName,
      label: `${tool.title} · ${tool.serverLabel}`,
      description: `${tool.description ?? tool.title}\n\nProvided by the ${tool.serverLabel} MCP server. Every call requires fresh user approval.`,
      promptSnippet: `Use ${tool.title} from ${tool.serverLabel} when its explicit MCP capability is needed.`,
      parameters,
      executionMode: 'parallel',
      async execute(_toolCallId, arguments_, signal, _onUpdate, ctx) {
        const invalid = validate?.(arguments_) ?? []
        if (invalid.length > 0) {
          // Before approval: the user should never be asked to allow a call the server will reject.
          throw new Error(`Invalid arguments for MCP tool ${tool.title}: ${invalid.join('; ')}`)
        }
        const result = await executeApprovedCall({
          handle: tool.handle,
          arguments: arguments_,
          executeGateway,
          ctx,
          signal,
        })
        if (!result) {
          return {
            content: [{ type: 'text', text: 'MCP tool call was denied by the user.' }],
            details: { kind: 'gateway', result: null },
            isError: true,
          }
        }
        return textResult(result)
      },
    })
  }
}
