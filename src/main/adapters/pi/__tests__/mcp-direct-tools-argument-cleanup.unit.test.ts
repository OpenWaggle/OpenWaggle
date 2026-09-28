import type { ToolCall } from '@earendil-works/pi-ai/compat'
import { validateToolArguments } from '@earendil-works/pi-ai/utils/validation'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import {
  type PipelineCase,
  register,
  throughRepairedTool,
  toolCall,
} from './mcp-direct-tools-pipeline.test-utils'

interface CleanUpCase extends PipelineCase {
  readonly forwarded: ToolCall['arguments']
}

// Pi drops optional nulls and coerces stringified primitives; the repair must not undo that.
const CLEAN_UP_CASES: readonly CleanUpCase[] = [
  {
    label: 'a stringified number in an untyped root',
    schema: { properties: { n: { type: 'number' } } },
    arguments_: { n: '5' },
    forwarded: { n: 5 },
  },
  {
    label: 'a stringified integer in a discriminated oneOf',
    schema: {
      type: 'object',
      oneOf: [
        { properties: { kind: { const: 'a' }, limit: { type: 'integer' } }, required: ['kind'] },
        { properties: { kind: { const: 'b' } }, required: ['kind'] },
      ],
    },
    arguments_: { kind: 'a', limit: '10' },
    forwarded: { kind: 'a', limit: 10 },
  },
  {
    label: 'an optional null in an untyped root',
    schema: { properties: { q: { type: 'string' }, n: { type: 'number' } }, required: ['q'] },
    arguments_: { q: 'x', n: null },
    forwarded: { q: 'x' },
  },
]

describe('repaired MCP direct tools at call time', () => {
  it.each(CLEAN_UP_CASES)(
    "keeps Pi's clean-up of $label",
    async ({ schema, arguments_, forwarded }) => {
      expect(await throughRepairedTool(schema, arguments_)).toEqual({ accepted: true, forwarded })
    },
  )

  it('names the server-schema violation before asking for approval', async () => {
    const { definition, executeGateway } = register({
      type: 'object',
      properties: { n: { type: 'number' } },
      oneOf: [{ required: ['n'] }],
    })
    const confirm = vi.fn(async () => true)
    const ctx = fromPartial<ExtensionContext>({ hasUI: true, ui: { confirm } })

    await expect(
      definition.execute('call-1', { n: 'many' }, undefined, undefined, ctx),
    ).rejects.toThrow(/Invalid arguments for MCP tool probe: \/n: must be number/)
    expect(confirm).not.toHaveBeenCalled()
    expect(executeGateway).not.toHaveBeenCalled()
  })

  it('keeps the flattened repair as the pre-approval check when the server schema cannot compile', async () => {
    // The invalid pattern sits in a root keyword the repair drops, so only the server schema fails.
    const { definition } = register({
      type: 'object',
      not: { properties: { a: { type: 'string', pattern: '(?i)x' } } },
      anyOf: [{ properties: { a: { type: 'string' } }, required: ['a'] }],
    })
    const parameters = JSON.parse(JSON.stringify(definition.parameters))

    expect(parameters.properties).toEqual({ a: { type: 'string' } })
    expect(parameters.required).toEqual(['a'])
    expect(() => validateToolArguments(definition, toolCall({}))).toThrow(/a/)
  })
})
