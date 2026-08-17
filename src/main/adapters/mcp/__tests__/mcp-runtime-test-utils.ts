import type {
  McpCapabilityFamily,
  McpGatewayInput,
  McpTaskOperationInput,
  McpTurnSnapshot,
  McpTurnSnapshotServer,
} from '@shared/types/mcp'
import { Effect } from 'effect'
import type {
  McpRuntimeInteractions,
  McpRuntimeServiceShape,
} from '../../../ports/mcp-runtime-service'
import { makeMcpRuntimeService } from '../runtime/runtime-service-factory'
import type { McpClientConnection, McpRuntimeTool } from '../runtime/types'

/**
 * Build the Effect-native MCP runtime service and expose the legacy positional
 * Promise API used by the runtime unit tests. Construction is synchronous (only
 * Refs are allocated); each method runs its Effect at the test edge via
 * runPromise, so tagged failures surface as rejected promises (preserving
 * `rejects.toThrow(message)` assertions).
 */
export function createMcpRuntimeServiceForTests(
  input: Parameters<typeof makeMcpRuntimeService>[0],
) {
  const service = Effect.runSync(makeMcpRuntimeService(input))
  const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)
  return {
    prepareTurn: (turn: {
      readonly sessionId: string
      readonly snapshot: McpTurnSnapshot | null
    }) => run(service.prepareTurn(turn)),
    completeTurn: (turn: {
      readonly sessionId: string
      readonly nextSnapshot: McpTurnSnapshot | null
    }) => run(service.completeTurn(turn)),
    executeGateway: (
      snapshot: McpTurnSnapshot,
      request: McpGatewayInput,
      signal?: AbortSignal,
      interactions?: McpRuntimeInteractions,
    ) =>
      run(
        service.executeGateway({
          snapshot,
          request,
          ...(signal ? { signal } : {}),
          ...(interactions ? { interactions } : {}),
        }),
      ),
    listDirectTools: (snapshot: McpTurnSnapshot) => run(service.listDirectTools(snapshot)),
    browseCapabilities: (snapshot: McpTurnSnapshot, serverInstanceId?: string) =>
      run(
        service.browseCapabilities({
          snapshot,
          ...(serverInstanceId ? { serverInstanceId } : {}),
        }),
      ),
    getPrompt: (request: Parameters<McpRuntimeServiceShape['getPrompt']>[0]) =>
      run(service.getPrompt(request)),
    readResource: (request: Parameters<McpRuntimeServiceShape['readResource']>[0]) =>
      run(service.readResource(request)),
    reviewRemoteSkill: (request: Parameters<McpRuntimeServiceShape['reviewRemoteSkill']>[0]) =>
      run(service.reviewRemoteSkill(request)),
    callAppTool: (request: Parameters<McpRuntimeServiceShape['callAppTool']>[0]) =>
      run(service.callAppTool(request)),
    operateTask: (snapshot: McpTurnSnapshot | null, request: McpTaskOperationInput) =>
      run(service.operateTask({ snapshot, request })),
    setEventSubscription: (
      request: Parameters<McpRuntimeServiceShape['setEventSubscription']>[0],
    ) => run(service.setEventSubscription(request)),
    getEvents: (sessionId?: string | null) => run(service.getEvents(sessionId)),
    getEventSubscriptions: (sessionId?: string | null) =>
      run(service.getEventSubscriptions(sessionId)),
    disposeSession: (sessionId: string) => run(service.disposeSession(sessionId)),
    reconcileIdleConnections: () => run(service.reconcileIdleConnections()),
    disposeAll: () => run(service.disposeAll()),
    getConnectionStatuses: () => run(service.getConnectionStatuses()),
    getNotices: (sessionId?: string | null) => run(service.getNotices(sessionId)),
    doctor: () => run(service.doctor()),
  }
}

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
