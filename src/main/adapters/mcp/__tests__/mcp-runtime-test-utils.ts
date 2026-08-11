import type { McpCapabilityFamily, McpTurnSnapshot, McpTurnSnapshotServer } from '@shared/types/mcp'
import type { McpClientConnection, McpRuntimeTool } from '../runtime/types'

export function server(
  overrides: Partial<McpTurnSnapshotServer> & {
    readonly definition?: McpTurnSnapshotServer['definition']
  } = {},
): McpTurnSnapshotServer {
  return {
    instanceId: 'server-1',
    name: 'private-docs-server',
    sourcePath: '/project/.mcp.json',
    configHash: 'config-1',
    allowUnsandboxed: false,
    permissions: { readRoots: ['.'], writeRoots: [], allowNetwork: false },
    definition: { command: 'docs-mcp' },
    ...overrides,
  }
}

export function snapshot(overrides: Partial<McpTurnSnapshot> = {}): McpTurnSnapshot {
  return {
    id: 'snapshot-1',
    sessionId: 'session-1',
    projectPath: '/project',
    revision: 'revision-1',
    createdAt: 1,
    effectiveState: 'on',
    servers: [server()],
    ...overrides,
  }
}

export function connection(
  input: {
    readonly tools?: readonly McpRuntimeTool[]
    readonly capabilities?: readonly McpCapabilityFamily[]
    readonly callTool?: McpClientConnection['callTool']
    readonly listPrompts?: McpClientConnection['listPrompts']
    readonly listResources?: McpClientConnection['listResources']
    readonly readResource?: McpClientConnection['readResource']
    readonly listResourceTemplates?: McpClientConnection['listResourceTemplates']
    readonly listTasks?: McpClientConnection['listTasks']
    readonly listSkills?: McpClientConnection['listSkills']
    readonly getSkill?: McpClientConnection['getSkill']
    readonly instructions?: string
    readonly skillExtension?: McpClientConnection['skillExtension']
    readonly subscribeEvents?: McpClientConnection['subscribeEvents']
    readonly close?: () => Promise<void>
  } = {},
): McpClientConnection {
  return {
    negotiatedProtocolVersion: '2026-07-28',
    capabilities: input.capabilities ?? ['tools'],
    ...(input.instructions ? { instructions: input.instructions } : {}),
    ...(input.skillExtension ? { skillExtension: input.skillExtension } : {}),
    listTools: async () =>
      input.tools ?? [
        {
          name: 'search_private_docs',
          title: 'Search documentation',
          description: 'Find a passage in project documentation.',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ],
    callTool:
      input.callTool ??
      (async () => ({ content: [{ type: 'text', text: 'found' }], isError: false })),
    listPrompts: input.listPrompts ?? (async () => ({ prompts: [] })),
    getPrompt: async () => ({ messages: [] }),
    listResources: input.listResources ?? (async () => ({ resources: [] })),
    listResourceTemplates: input.listResourceTemplates ?? (async () => ({ resourceTemplates: [] })),
    readResource: input.readResource ?? (async () => ({ contents: [] })),
    listSkills: input.listSkills ?? (async () => ({ skills: [] })),
    getSkill:
      input.getSkill ??
      (async ({ uri }) => ({
        skill: { uri, frontmatter: { name: 'skill', description: 'Test Skill' }, resources: [] },
      })),
    listTasks: input.listTasks ?? (async () => ({ tasks: [] })),
    getTask: async ({ taskId }) => ({ taskId, status: 'working' }),
    cancelTask: async ({ taskId }) => ({ taskId, status: 'cancelled' }),
    subscribeEvents:
      input.subscribeEvents ??
      (async ({ resourceUris }) => ({
        mode: 'modern-listen',
        resourceUris,
        close: async () => undefined,
      })),
    close: input.close ?? (async () => undefined),
  }
}
