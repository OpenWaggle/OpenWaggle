import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { McpDirectToolDescriptor } from '@shared/types/mcp'
import { type TUnsafe, Type } from 'typebox'
import { createLogger } from '../../logger'
import {
  type McpDirectToolCallValidation,
  mcpDirectToolCallArguments,
} from './mcp-direct-tool-call-validation'
import { type ExecuteGateway, executeApprovedCall, textResult } from './mcp-tool-execution'
import { relaxForPreCallValidation } from './provider-tool-parameter-relaxation'
import { isJsonSchemaObject, providerToolParameters } from './provider-tool-parameter-schema'
import { compileToolArgumentsValidator } from './tool-arguments-validator'

const logger = createLogger('mcp-direct-tools')

type ToolParameters = TUnsafe<Record<string, unknown>>

interface PreparedParameters {
  readonly parameters: ToolParameters
  /** Present when the provider-facing schema is looser than the server's own schema. */
  readonly callValidation?: McpDirectToolCallValidation
  readonly repairs: readonly string[]
  readonly validationUnavailable?: string
}

/**
 * MCP servers publish arbitrary JSON Schema, but Bedrock and OpenAI reject tools whose parameter
 * root is not an object (a root union, `$ref`, missing `type`, ...). Hand Pi a provider-valid
 * object schema and keep the server's schema to validate the real arguments at call time.
 *
 * Pi validates each call against the provider-facing schema before `execute`, so when the server
 * schema can be enforced at call time the repaired schema is relaxed to never reject an argument
 * the server schema accepts. When it cannot be compiled, the flattened repair stays the only
 * pre-approval check and the server validates the rest.
 */
function prepareParameters(tool: McpDirectToolDescriptor): PreparedParameters {
  const normalized = providerToolParameters(tool.inputSchema)
  if (normalized.repairs.length === 0 || !isJsonSchemaObject(tool.inputSchema)) {
    return {
      parameters: Type.Unsafe<Record<string, unknown>>(normalized.schema),
      repairs: normalized.repairs,
    }
  }
  const compiled = compileToolArgumentsValidator(tool.inputSchema)
  if (!('validate' in compiled)) {
    return {
      parameters: Type.Unsafe<Record<string, unknown>>(normalized.schema),
      repairs: normalized.repairs,
      validationUnavailable: compiled.error,
    }
  }
  const repairs = [...normalized.repairs]
  const relaxed = relaxForPreCallValidation({ ...normalized.schema }, tool.inputSchema, repairs)
  return {
    parameters: Type.Unsafe<Record<string, unknown>>(relaxed),
    callValidation: {
      server: Type.Unsafe<Record<string, unknown>>(tool.inputSchema),
      flattened: Type.Unsafe<Record<string, unknown>>(normalized.schema),
      validate: compiled.validate,
    },
    repairs,
  }
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
            callTimeValidation: parameters.callValidation
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
  for (const [tool, { parameters, callValidation }] of prepared) {
    pi.registerTool({
      name: tool.modelName,
      label: `${tool.title} · ${tool.serverLabel}`,
      description: `${tool.description ?? tool.title}\n\nProvided by the ${tool.serverLabel} MCP server. Every call requires fresh user approval.`,
      promptSnippet: `Use ${tool.title} from ${tool.serverLabel} when its explicit MCP capability is needed.`,
      parameters,
      executionMode: 'parallel',
      async execute(_toolCallId, arguments_, signal, _onUpdate, ctx) {
        // Before approval: the user should never be asked to allow a call the server will reject.
        const callArguments = callValidation
          ? mcpDirectToolCallArguments(tool, callValidation, arguments_)
          : arguments_
        const result = await executeApprovedCall({
          handle: tool.handle,
          arguments: callArguments,
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
