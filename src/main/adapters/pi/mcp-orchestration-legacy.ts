import { decodeUnknownOrThrow } from '@shared/schema'
import { mcpConfigValueSchema } from '@shared/schemas/mcp'
import type { McpJsonValue } from '@shared/types/mcp'
import type { McpOrchestrationProgram } from './mcp-orchestration-language-types'

function jsonValue(value: unknown): McpJsonValue {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('MCP orchestration produced a non-JSON value.')
  const parsed: unknown = JSON.parse(serialized)
  return decodeUnknownOrThrow(mcpConfigValueSchema, parsed)
}

export function compileLegacyMcpOrchestration(input: {
  readonly mode: 'sequential' | 'parallel'
  readonly calls: readonly {
    readonly id: string
    readonly handle: string
    readonly arguments?: Readonly<Record<string, unknown>>
  }[]
}): McpOrchestrationProgram {
  const ids = new Set(input.calls.map((call) => call.id))
  if (ids.size !== input.calls.length) throw new Error('MCP run call ids must be unique.')
  const calls = input.calls.map((call) => ({
    id: call.id,
    handle: call.handle,
    arguments: { type: 'literal' as const, value: jsonValue(call.arguments ?? {}) },
  }))
  if (input.mode === 'parallel') {
    return {
      statements: [
        {
          type: 'parallel',
          names: calls.map((_, index) => `legacy_${String(index)}`),
          calls,
        },
      ],
    }
  }
  return {
    statements: calls.map((call, index) => ({
      type: 'call',
      name: `legacy_${String(index)}`,
      call,
    })),
  }
}
