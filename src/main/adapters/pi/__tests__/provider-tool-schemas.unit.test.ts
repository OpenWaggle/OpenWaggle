import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { SessionId } from '@shared/types/brand'
import type {
  McpDirectToolDescriptor,
  McpGatewayInput,
  McpGatewayResult,
  McpJsonValue,
  McpTurnSnapshot,
} from '@shared/types/mcp'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserPreviewAutomationServiceShape } from '../../../ports/browser-preview-automation-service'
import { createBrowserPreviewAutomationExtension } from '../browser-preview-automation-extension'
import { createMcpGatewayExtension } from '../mcp-gateway-extension'
import { createProjectActionsToolExtension } from '../project-actions-tool-extension'
import { providerToolSchemaViolations } from '../provider-tool-parameter-schema'
import { createSessionsToolExtension } from '../sessions-tool-extension'
import { providerToolPayloads } from './provider-tool-payload.test-utils'

const SNAPSHOT: McpTurnSnapshot = {
  id: 'snapshot-1',
  sessionId: 'session-1',
  projectPath: '/project',
  revision: 'revision-1',
  createdAt: 1,
  effectiveState: 'on',
  servers: [],
}

function directTool(name: string, inputSchema?: McpJsonValue): McpDirectToolDescriptor {
  return {
    modelName: `mcp_probe_${name}`,
    handle: `handle-${name}`,
    title: name,
    serverLabel: 'Probe',
    ...(inputSchema === undefined ? {} : { inputSchema }),
  }
}

/** Real schemas served today by chrome-devtools-mcp and @playwright/mcp; they must pass through untouched. */
const REAL_DIRECT_TOOLS = [
  directTool('resize_page', {
    type: 'object',
    properties: {
      pageId: { type: 'number', description: 'Targets a specific page by ID.' },
      width: { type: 'number', description: 'Page width' },
      height: { type: 'number', description: 'Page height' },
    },
    required: ['pageId', 'width', 'height'],
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    additionalProperties: {},
  }),
  directTool('browser_close', {
    type: 'object',
    properties: {},
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    additionalProperties: false,
  }),
]

/** Shapes third-party MCP servers do publish even though the MCP spec asks for `type: "object"`. */
const NON_OBJECT_ROOT_DIRECT_TOOLS = [
  directTool('missing_schema'),
  directTool('untyped_properties', {
    properties: { query: { type: 'string' } },
    required: ['query'],
  }),
  directTool('nullable_object', {
    type: ['object', 'null'],
    properties: { query: { type: 'string' } },
  }),
  directTool('root_any_of', {
    anyOf: [
      {
        type: 'object',
        properties: { kind: { const: 'id' }, id: { type: 'string' } },
        required: ['kind', 'id'],
      },
      {
        type: 'object',
        properties: { kind: { const: 'url' }, url: { type: 'string' } },
        required: ['kind', 'url'],
      },
    ],
  }),
  directTool('root_one_of_typed', {
    type: 'object',
    oneOf: [
      { properties: { a: { type: 'number' } }, required: ['a'] },
      { properties: { b: { type: 'number' } }, required: ['b'] },
    ],
  }),
  directTool('root_all_of', {
    allOf: [
      { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
      { type: 'object', properties: { b: { type: 'string' } } },
    ],
  }),
  directTool('root_ref', {
    $ref: '#/$defs/Arguments',
    $defs: {
      Arguments: {
        type: 'object',
        properties: { path: { type: 'string' }, child: { $ref: '#/$defs/Child' } },
        required: ['path'],
      },
      Child: { type: 'object', properties: { name: { type: 'string' } } },
    },
  }),
  directTool('root_string', { type: 'string' }),
  directTool('root_boolean', true),
]

const browserPreviewService = fromPartial<BrowserPreviewAutomationServiceShape>({
  resize: vi.fn(() => Effect.succeed({ tabId: 'tab-1', viewport: { mode: 'fill' as const } })),
})

async function collect(factory: (pi: ExtensionAPI) => unknown) {
  const tools: ToolDefinition[] = []
  await factory(
    fromPartial<ExtensionAPI>({
      registerTool: (tool: ToolDefinition) => tools.push(tool),
      on: () => undefined,
    }),
  )
  return tools
}

async function openWaggleTools(directTools: readonly McpDirectToolDescriptor[]) {
  const executeGateway = async (): Promise<McpGatewayResult> => ({ operation: 'list', text: '' })
  return [
    ...(await collect(
      createBrowserPreviewAutomationExtension({
        scope: { sessionId: SessionId('session-1'), workingPath: '/project' },
        service: browserPreviewService,
      }),
    )),
    ...(await collect(
      createProjectActionsToolExtension({
        sessionId: SessionId('session-1'),
        runId: 'run-1',
        catalog: fromPartial({}),
        runs: fromPartial({}),
        workspaces: fromPartial({}),
      }),
    )),
    ...(await collect(
      createSessionsToolExtension({
        sessionId: 'session-1',
        runId: 'run-1',
        workingDirectory: '/project',
      }),
    )),
    ...(await collect(
      createMcpGatewayExtension({ snapshot: SNAPSHOT, executeGateway, directTools }),
    )),
  ]
}

function violationsByTool(schemas: ReadonlyMap<string, unknown>) {
  const violations: Record<string, readonly string[]> = {}
  for (const [name, schema] of schemas) {
    const found = providerToolSchemaViolations(schema)
    if (found.length > 0) violations[name] = found
  }
  return violations
}

describe('tool schemas OpenWaggle hands to Pi', () => {
  it('reach Bedrock and OpenAI with an object root for every OpenWaggle tool', async () => {
    const tools = await openWaggleTools(REAL_DIRECT_TOOLS)
    const payloads = await providerToolPayloads(tools)

    expect(payloads.bedrock.size).toBe(tools.length)
    expect(payloads.openai.size).toBe(tools.length)
    expect(violationsByTool(payloads.bedrock)).toEqual({})
    expect(violationsByTool(payloads.openai)).toEqual({})
  })

  it('passes conforming MCP schemas through unchanged', async () => {
    const payloads = await providerToolPayloads(
      (await openWaggleTools(REAL_DIRECT_TOOLS)).filter((tool) =>
        tool.name.startsWith('mcp_probe'),
      ),
    )

    for (const tool of REAL_DIRECT_TOOLS) {
      expect(payloads.bedrock.get(tool.modelName)).toEqual(tool.inputSchema)
      expect(payloads.openai.get(tool.modelName)).toEqual(tool.inputSchema)
    }
  })

  it('repairs MCP input schemas whose root is not an object before Bedrock or OpenAI sees them', async () => {
    const tools = (await openWaggleTools(NON_OBJECT_ROOT_DIRECT_TOOLS)).filter((tool) =>
      tool.name.startsWith('mcp_probe'),
    )
    const payloads = await providerToolPayloads(tools)

    expect(tools).toHaveLength(NON_OBJECT_ROOT_DIRECT_TOOLS.length)
    expect(violationsByTool(payloads.bedrock)).toEqual({})
    expect(violationsByTool(payloads.openai)).toEqual({})
  })
})

describe('repaired MCP direct tools keep their argument semantics', () => {
  function context() {
    return fromPartial<ExtensionContext>({ hasUI: true, ui: { confirm: async () => true } })
  }

  async function registered(tool: McpDirectToolDescriptor) {
    const executeGateway = vi.fn(
      async (request: McpGatewayInput): Promise<McpGatewayResult> =>
        request.operation === 'describe'
          ? {
              operation: 'describe',
              text: 'described',
              tools: [{ handle: tool.handle, title: tool.title, inputSchema: { type: 'object' } }],
              attribution: {
                serverInstanceId: 'probe',
                serverLabel: 'Probe',
                toolName: tool.title,
              },
            }
          : { operation: 'call', text: 'completed', result: { ok: true } },
    )
    const tools = await collect(
      createMcpGatewayExtension({ snapshot: SNAPSHOT, executeGateway, directTools: [tool] }),
    )
    const definition = tools.find((candidate) => candidate.name === tool.modelName)
    if (!definition) throw new Error(`${tool.modelName} was not registered`)
    return { definition, executeGateway }
  }

  function schemaOf(definition: ToolDefinition) {
    return JSON.parse(JSON.stringify(definition.parameters))
  }

  it('flattens a root union into one object that still lists every argument', async () => {
    const tool = NON_OBJECT_ROOT_DIRECT_TOOLS.find((candidate) => candidate.title === 'root_any_of')
    if (!tool) throw new Error('fixture missing')
    const { definition } = await registered(tool)
    const schema = schemaOf(definition)

    expect(schema.type).toBe('object')
    expect(schema.anyOf).toBeUndefined()
    expect(Object.keys(schema.properties).sort()).toEqual(['id', 'kind', 'url'])
    // Only what every alternative requires can be required at the flattened root.
    expect(schema.required).toEqual(['kind'])
    expect(schema.description).toMatch(/kind/)
  })

  it('inlines a root $ref and keeps the definitions nested references need', async () => {
    const tool = NON_OBJECT_ROOT_DIRECT_TOOLS.find((candidate) => candidate.title === 'root_ref')
    if (!tool) throw new Error('fixture missing')
    const schema = schemaOf((await registered(tool)).definition)

    expect(schema).toMatchObject({
      type: 'object',
      properties: { path: { type: 'string' }, child: { $ref: '#/$defs/Child' } },
      required: ['path'],
      $defs: { Child: { type: 'object' } },
    })
    expect(schema.$ref).toBeUndefined()
  })

  it('validates call arguments against the server schema before calling the server', async () => {
    const tool = NON_OBJECT_ROOT_DIRECT_TOOLS.find((candidate) => candidate.title === 'root_any_of')
    if (!tool) throw new Error('fixture missing')
    const { definition, executeGateway } = await registered(tool)

    // Valid for the flattened schema (kind is present) but for neither server alternative.
    await expect(
      definition.execute('call-1', { kind: 'id' }, undefined, undefined, context()),
    ).rejects.toThrow(/Invalid arguments for MCP tool root_any_of/)
    expect(executeGateway).not.toHaveBeenCalled()

    await definition.execute('call-2', { kind: 'id', id: 'abc' }, undefined, undefined, context())
    expect(executeGateway).toHaveBeenLastCalledWith(
      { operation: 'call', handle: tool.handle, arguments: { kind: 'id', id: 'abc' } },
      undefined,
      expect.anything(),
    )
  })
})
