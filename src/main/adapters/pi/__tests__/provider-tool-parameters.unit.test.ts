import type { Context } from '@earendil-works/pi-ai/compat'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import type { McpJsonValue } from '@shared/types/mcp'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { complete } = vi.hoisted(() => ({
  complete: vi.fn(async (_model: unknown, _context: Context) => ({
    content: [],
    stopReason: 'stop',
  })),
}))

vi.mock('@earendil-works/pi-ai/compat', () => ({ complete }))

type SchemaRoot = { readonly type?: unknown } & Readonly<Record<string, unknown>>

interface SchemaCase {
  readonly label: string
  readonly schema: McpJsonValue | undefined
}

function plain(value: unknown) {
  // TypeBox schemas carry symbols; serialize to the JSON the provider receives.
  return fromAny<SchemaRoot, unknown>(JSON.parse(JSON.stringify(value)))
}

const PROPERTIES = { a: { type: 'string' }, b: { type: 'string' } } satisfies McpJsonValue

const ROOT_UNION_CASES: readonly SchemaCase[] = ['anyOf', 'oneOf', 'allOf'].map((label) => ({
  label,
  schema: {
    type: 'object',
    properties: PROPERTIES,
    required: ['b'],
    description: 'd',
    [label]: [{ required: ['a'] }],
  },
}))

const OPEN_FALLBACK_CASES: readonly SchemaCase[] = [
  { label: 'missing', schema: undefined },
  { label: 'array', schema: [] },
  { label: 'string root', schema: { type: 'string' } },
  { label: 'untyped union', schema: { anyOf: [{ type: 'object' }] } },
]

describe('provider tool parameters for external MCP schemas', () => {
  it.each(ROOT_UNION_CASES)(
    'drops a root $label that Bedrock-hosted Claude rejects but keeps the argument shape',
    async ({ label, schema }) => {
      const { toProviderToolParameters } = await import('../provider-tool-parameters')

      const root = plain(toProviderToolParameters(schema))

      expect(root[label]).toBeUndefined()
      expect(root).toEqual({
        type: 'object',
        properties: PROPERTIES,
        required: ['b'],
        description: 'd',
      })
    },
  )

  it('passes a provider-safe object schema through unchanged', async () => {
    const { toProviderToolParameters } = await import('../provider-tool-parameters')
    const schema = {
      type: 'object',
      properties: PROPERTIES,
      required: ['a'],
      not: { required: ['b'] },
    } satisfies McpJsonValue

    expect(plain(toProviderToolParameters(schema))).toEqual(schema)
  })

  it.each(OPEN_FALLBACK_CASES)(
    'falls back to an open object for a $label schema',
    async ({ schema }) => {
      const { toProviderToolParameters } = await import('../provider-tool-parameters')

      const root = plain(toProviderToolParameters(schema))

      expect(root.type).toBe('object')
      expect(root.anyOf).toBeUndefined()
      expect(root.properties).toBeUndefined()
    },
  )
})

describe('MCP sampling tool parameters', () => {
  beforeEach(() => complete.mockClear())

  it('sends server-provided sampling tools with provider-safe object roots', async () => {
    const { createPiMcpRuntimeInteractions } = await import('../mcp-client-interactions')
    const model = {
      provider: 'amazon-bedrock',
      id: 'eu.anthropic.claude-opus-4-8',
      maxTokens: 1_024,
    }
    const ctx = fromPartial<ExtensionContext>({
      hasUI: true,
      model,
      ui: { confirm: async () => true },
      modelRegistry: { find: () => model, getApiKeyAndHeaders: async () => ({ ok: true }) },
    })

    await createPiMcpRuntimeInteractions(ctx).sample({
      serverInstanceId: 'server-1',
      serverLabel: 'Test server',
      request: {
        messages: [],
        maxTokens: 16,
        tools: [
          { name: 'valid', inputSchema: { type: 'object', properties: PROPERTIES } },
          { name: 'union', inputSchema: { type: 'object', properties: PROPERTIES, anyOf: [] } },
          { name: 'string_root', inputSchema: { type: 'string' } },
          { name: 'missing' },
        ],
      },
    })

    const tools = complete.mock.calls[0]?.[1].tools ?? []
    expect(tools.map((tool) => tool.name)).toEqual(['valid', 'union', 'string_root', 'missing'])
    for (const tool of tools) {
      const root = plain(tool.parameters)
      expect(root.type).toBe('object')
      expect(root.anyOf).toBeUndefined()
    }
    expect(plain(tools[1]?.parameters).properties).toEqual(PROPERTIES)
  })
})
