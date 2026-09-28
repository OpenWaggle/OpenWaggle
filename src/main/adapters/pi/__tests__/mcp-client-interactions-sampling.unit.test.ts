import type { Context } from '@earendil-works/pi-ai/compat'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { createPiMcpRuntimeInteractions } from '../mcp-client-interactions'

const { complete } = vi.hoisted(() => ({
  complete: vi.fn(async (_model: unknown, _context: Context) => ({
    content: [],
    stopReason: 'stop',
  })),
}))

vi.mock('@earendil-works/pi-ai/compat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@earendil-works/pi-ai/compat')>()),
  complete,
}))

type SchemaRoot = { readonly type?: unknown } & Readonly<Record<string, unknown>>

function plain(value: unknown) {
  // TypeBox schemas carry symbols; serialize to the JSON the provider receives.
  return fromAny<SchemaRoot, unknown>(JSON.parse(JSON.stringify(value)))
}

const PROPERTIES = { a: { type: 'string' }, b: { type: 'string' } }

describe('MCP sampling tools', () => {
  it('sends server-provided sampling tools with provider-safe object roots', async () => {
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
    expect(plain(tools[0]?.parameters).properties).toEqual(PROPERTIES)
    expect(plain(tools[1]?.parameters).properties).toEqual({
      a: { anyOf: [{ type: 'string' }, {}] },
      b: { anyOf: [{ type: 'string' }, {}] },
    })
  })
})
