import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { SessionId } from '@shared/types/brand'
import type { McpDirectToolDescriptor, McpTurnSnapshot } from '@shared/types/mcp'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserPreviewAutomationServiceShape } from '../../../ports/browser-preview-automation-service'
import { createBrowserPreviewAutomationExtension } from '../browser-preview-automation-extension'
import { createMcpGatewayExtension } from '../mcp-gateway-extension'
import { registerMcpOrchestrationTool } from '../mcp-orchestration-extension'
import { createProjectActionsToolExtension } from '../project-actions-tool-extension'
import { createSessionsToolExtension } from '../sessions-tool-extension'

// Every provider-facing tool schema must be a JSON object at the root. Amazon Bedrock
// rejects the whole request otherwise ("toolConfig.tools.N.toolSpec.inputSchema.json.type
// must be one of the following: object"), Pi's Anthropic serializer drops root unions to
// an empty object, and OpenAI-completions providers emit `{}` arguments for them.
const ROOT_COMBINATORS = ['anyOf', 'oneOf', 'allOf', 'not'] as const

type SchemaRoot = { readonly type?: unknown } & Readonly<Record<string, unknown>>

function schemaRoot(tool: ToolDefinition) {
  // The schema carries TypeBox symbols; serialize to the JSON the provider receives.
  return fromAny<SchemaRoot, unknown>(JSON.parse(JSON.stringify(tool.parameters)))
}

function collectTools(register: (pi: ExtensionAPI) => unknown) {
  const tools: ToolDefinition[] = []
  register(
    fromPartial<ExtensionAPI>({
      registerTool: (tool: ToolDefinition) => {
        tools.push(tool)
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

function firstPartyTools() {
  const executeGateway = vi.fn()
  return [
    ...collectTools((pi) =>
      createBrowserPreviewAutomationExtension({
        scope: { sessionId: SessionId('session-1'), workingPath: '/project' },
        service: fromPartial<BrowserPreviewAutomationServiceShape>({}),
      })(pi),
    ),
    ...collectTools((pi) =>
      createMcpGatewayExtension({
        snapshot: SNAPSHOT,
        executeGateway,
        directTools: [
          directTool('direct_valid', { type: 'object', properties: {} }),
          directTool('direct_missing', undefined),
          directTool('direct_array', []),
          directTool('direct_union', { anyOf: [{ type: 'object' }] }),
          directTool('direct_string', { type: 'string' }),
        ],
      })(pi),
    ),
    ...collectTools((pi) => registerMcpOrchestrationTool(pi, executeGateway)),
    ...collectTools((pi) =>
      createProjectActionsToolExtension({
        sessionId: SessionId('session-1'),
        runId: 'run-1',
        workspaces: fromPartial({}),
        catalog: fromPartial({}),
        runs: fromPartial({}),
      })(pi),
    ),
    ...collectTools((pi) =>
      createSessionsToolExtension({
        sessionId: 'session-1',
        runId: 'run-1',
        workingDirectory: '/project',
      })(pi),
    ),
    ...collectTools((pi) =>
      createSessionsToolExtension({
        sessionId: 'session-1',
        runId: 'run-1',
        workingDirectory: '/project',
        sessionCapabilities: ['sessions:read', 'sessions:spawn', 'delegations:contribute'],
      })(pi),
    ),
  ]
}

describe('first-party Pi tool parameter schemas', () => {
  const tools = firstPartyTools()

  it('covers the registered first-party tool surface', () => {
    const names = tools.map((tool) => tool.name)

    expect(names).toEqual(
      expect.arrayContaining([
        'preview_resize',
        'mcp',
        'direct_valid',
        'direct_union',
        'mcp_run',
        'project_actions',
        'sessions',
      ]),
    )
  })

  it.each(tools.map((tool) => [tool.name, tool] as const))(
    '%s exposes an object root without root-level combinators',
    (_name, tool) => {
      const root = schemaRoot(tool)

      expect(root.type).toBe('object')
      for (const combinator of ROOT_COMBINATORS) {
        expect(root[combinator]).toBeUndefined()
      }
    },
  )
})
