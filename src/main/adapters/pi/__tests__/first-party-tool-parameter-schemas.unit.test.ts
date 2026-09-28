import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { SessionId } from '@shared/types/brand'
import type { McpDirectToolDescriptor, McpTurnSnapshot } from '@shared/types/mcp'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserPreviewAutomationServiceShape } from '../../../ports/browser-preview-automation-service'
import { createBrowserPreviewAutomationExtension } from '../browser-preview-automation-extension'
import { createMcpGatewayExtension } from '../mcp-gateway-extension'
import { createProjectActionsToolExtension } from '../project-actions-tool-extension'
import { createSessionsToolExtension } from '../sessions-tool-extension'

// Every provider-facing tool schema must be a JSON object at the root without the root
// keywords providers reject. Amazon Bedrock fails the whole request otherwise ("...inputSchema
// .json.type must be one of the following: object", or for Claude "input_schema does not
// support oneOf, allOf, or anyOf at the top level"), and OpenAI rejects root
// oneOf/anyOf/allOf/enum/const/not. Pi's Anthropic serializer drops root unions to an empty
// object, and OpenAI-completions providers emit `{}` arguments for them.
const UNSUPPORTED_ROOT_KEYWORDS = ['anyOf', 'oneOf', 'allOf', 'enum', 'const', 'not'] as const

type SchemaRoot = { readonly type?: unknown } & Readonly<Record<string, unknown>>

function schemaRoot(tool: ToolDefinition) {
  // The schema carries TypeBox symbols; serialize to the JSON the provider receives.
  return fromAny<SchemaRoot, unknown>(JSON.parse(JSON.stringify(tool.parameters)))
}

async function collectTools(label: string, register: (pi: ExtensionAPI) => unknown) {
  const tools: { readonly name: string; readonly tool: ToolDefinition }[] = []
  await register(
    fromPartial<ExtensionAPI>({
      registerTool: (tool: ToolDefinition) => {
        tools.push({ name: `${label}/${tool.name}`, tool })
      },
    }),
  )
  return tools
}

const SNAPSHOT: McpTurnSnapshot = {
  id: 'snapshot-1',
  sessionId: 'session-1',
  projectPath: '/project',
  revision: 'revision-1',
  createdAt: 1,
  effectiveState: 'on',
  servers: [],
}

function directTool(
  modelName: string,
  inputSchema: McpDirectToolDescriptor['inputSchema'],
): McpDirectToolDescriptor {
  return fromPartial<McpDirectToolDescriptor>({
    handle: `handle-${modelName}`,
    modelName,
    title: modelName,
    serverLabel: 'Test server',
    ...(inputSchema === undefined ? {} : { inputSchema }),
  })
}

async function firstPartyTools() {
  const executeGateway = vi.fn()
  const groups = await Promise.all([
    collectTools('browser-preview', (pi) =>
      createBrowserPreviewAutomationExtension({
        scope: { sessionId: SessionId('session-1'), workingPath: '/project' },
        service: fromPartial<BrowserPreviewAutomationServiceShape>({}),
      })(pi),
    ),
    collectTools('mcp', (pi) =>
      createMcpGatewayExtension({
        snapshot: SNAPSHOT,
        executeGateway,
        directTools: [
          directTool('direct_valid', { type: 'object', properties: {} }),
          directTool('direct_missing', undefined),
          directTool('direct_array', []),
          directTool('direct_union', { anyOf: [{ type: 'object' }] }),
          directTool('direct_object_union', {
            type: 'object',
            properties: { a: { type: 'string' } },
            anyOf: [{ required: ['a'] }],
          }),
          directTool('direct_string', { type: 'string' }),
        ],
      })(pi),
    ),
    collectTools('project-actions', (pi) =>
      createProjectActionsToolExtension({
        sessionId: SessionId('session-1'),
        runId: 'run-1',
        workspaces: fromPartial({}),
        catalog: fromPartial({}),
        runs: fromPartial({}),
      })(pi),
    ),
    collectTools('sessions-default', (pi) =>
      createSessionsToolExtension({
        sessionId: 'session-1',
        runId: 'run-1',
        workingDirectory: '/project',
      })(pi),
    ),
    collectTools('sessions-capabilities', (pi) =>
      createSessionsToolExtension({
        sessionId: 'session-1',
        runId: 'run-1',
        workingDirectory: '/project',
        sessionCapabilities: ['sessions:read', 'sessions:spawn', 'delegations:contribute'],
      })(pi),
    ),
  ])
  return groups.flat()
}

describe('first-party Pi tool parameter schemas', async () => {
  const tools = await firstPartyTools()

  it('covers the registered first-party tool surface', () => {
    // Exact list: a new first-party tool must be added to firstPartyTools() to be checked.
    expect(tools.map(({ name }) => name).sort()).toEqual(
      [
        'browser-preview/preview_click',
        'browser-preview/preview_evaluate',
        'browser-preview/preview_navigate',
        'browser-preview/preview_open',
        'browser-preview/preview_press',
        'browser-preview/preview_recording_start',
        'browser-preview/preview_recording_stop',
        'browser-preview/preview_resize',
        'browser-preview/preview_scroll',
        'browser-preview/preview_set_appearance',
        'browser-preview/preview_snapshot',
        'browser-preview/preview_status',
        'browser-preview/preview_type',
        'browser-preview/preview_wait_for',
        'mcp/direct_array',
        'mcp/direct_missing',
        'mcp/direct_object_union',
        'mcp/direct_string',
        'mcp/direct_union',
        'mcp/direct_valid',
        'mcp/mcp',
        'mcp/mcp_run',
        'project-actions/project_actions',
        'sessions-capabilities/sessions',
        'sessions-default/sessions',
      ].sort(),
    )
  })

  it.each(tools.map(({ name, tool }) => [name, tool] as const))(
    '%s exposes an object root without unsupported root keywords',
    (_name, tool) => {
      const root = schemaRoot(tool)

      expect(root.type).toBe('object')
      for (const keyword of UNSUPPORTED_ROOT_KEYWORDS) {
        expect(root[keyword]).toBeUndefined()
      }
    },
  )

  it('keeps the argument properties of an object-rooted MCP schema with a root union', () => {
    const tool = tools.find(({ name }) => name === 'mcp/direct_object_union')?.tool
    if (!tool) throw new Error('direct_object_union was not registered.')

    expect(schemaRoot(tool).properties).toEqual({ a: { type: 'string' } })
  })
})
