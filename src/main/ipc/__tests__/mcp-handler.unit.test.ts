import type { McpSettingsView } from '@shared/types/mcp'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { McpConfigService, type McpConfigServiceShape } from '../../ports/mcp-config-service'
import {
  type McpRuntimeConnectionStatus,
  McpRuntimeService,
  type McpRuntimeServiceShape,
} from '../../ports/mcp-runtime-service'

const { typedHandleMock } = vi.hoisted(() => ({ typedHandleMock: vi.fn() }))

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))
vi.mock('../typed-ipc', () => ({ typedHandle: typedHandleMock }))

import { registerMcpHandlers } from '../mcp-handler'

const PROJECT_PATH = process.cwd()
const SETTINGS_VIEW: McpSettingsView = {
  integration: {
    desired: {
      global: 'on',
      project: 'inherit',
      session: 'inherit',
      effective: 'on',
      source: 'global',
    },
    applied: 'on',
    applyState: 'applied',
  },
  sources: [],
  servers: [
    {
      instanceId: 'server-1',
      name: 'docs',
      enabled: true,
      trusted: 'trusted',
      required: false,
      sourceId: 'project-standard',
      sourceLabel: 'Project MCP',
      sourcePath: `${PROJECT_PATH}/.mcp.json`,
      configHash: 'config-1',
      command: 'docs-mcp',
      transport: 'stdio',
      compatibility: 'auto',
      directTools: 'disabled',
      auth: 'none',
      requestedPermissions: { readRoots: ['.'], writeRoots: [], allowNetwork: false },
      connectionState: 'disconnected',
      capabilities: [],
    },
  ],
  notices: [],
  projectPath: PROJECT_PATH,
  sessionId: 'session-1',
}

function makeTestLayer(input?: { readonly clearStatusesOnReconcile?: boolean }) {
  let statuses: McpRuntimeConnectionStatus[] = [
    {
      runtimeNamespace: 'mcp-management:session-1',
      sessionId: 'session-1',
      projectPath: PROJECT_PATH,
      snapshotRevision: 'revision-1',
      serverInstanceId: 'server-1',
      connectionState: 'connected',
      negotiatedProtocolVersion: '2026-07-28',
      capabilities: ['tools', 'prompts'],
    },
  ]
  const reconcileIdleConnections = vi.fn(() =>
    Effect.sync(() => {
      if (input?.clearStatusesOnReconcile) statuses = []
    }),
  )
  const browseCapabilities = vi.fn<McpRuntimeServiceShape['browseCapabilities']>(() =>
    Effect.succeed({
      instructions: [],
      prompts: [],
      resources: [],
      resourceTemplates: [],
      apps: [],
      tasks: [],
      skills: [],
    }),
  )
  const config = fromPartial<McpConfigServiceShape>({
    getView: () => Effect.succeed(SETTINGS_VIEW),
    setScopeState: () => Effect.succeed(SETTINGS_VIEW),
    createTurnSnapshot: ({ projectPath, sessionId }: { projectPath: string; sessionId: string }) =>
      Effect.succeed({
        id: 'snapshot-1',
        projectPath,
        sessionId,
        revision: 'revision-1',
        createdAt: 1,
        effectiveState: 'on',
        servers: [],
      }),
  })
  const runtime = fromPartial<McpRuntimeServiceShape>({
    browseCapabilities,
    reconcileIdleConnections,
    getConnectionStatuses: () => Effect.sync(() => statuses),
    getNotices: () =>
      Effect.succeed([
        {
          id: 'runtime:connected',
          severity: 'info',
          title: 'MCP connected',
          detail: 'The management connection is active.',
          serverInstanceId: 'server-1',
        },
      ]),
  })
  return {
    layer: Layer.mergeAll(
      Layer.succeed(McpConfigService, config),
      Layer.succeed(McpRuntimeService, runtime),
    ),
    reconcileIdleConnections,
    browseCapabilities,
  }
}

function getRegisteredHandler(name: string, layer: ReturnType<typeof makeTestLayer>['layer']) {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') return undefined
  return (...args: unknown[]) => Effect.runPromise(Effect.provide(handler(...args), layer))
}

describe('MCP IPC runtime settings lifecycle', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    registerMcpHandlers()
  })

  it('returns live connection, capability, and runtime notice state', async () => {
    const test = makeTestLayer()
    const handler = getRegisteredHandler('mcp:get-settings', test.layer)

    const view = await handler?.({}, { projectPath: PROJECT_PATH, sessionId: 'session-1' })

    expect(view).toMatchObject({
      servers: [
        {
          instanceId: 'server-1',
          connectionState: 'connected',
          negotiatedProtocolVersion: '2026-07-28',
          capabilities: ['tools', 'prompts'],
        },
      ],
      notices: [expect.objectContaining({ id: 'runtime:connected' })],
    })
  })

  it('browses capabilities in a management namespace distinct from the logical session', async () => {
    const test = makeTestLayer()
    const handler = getRegisteredHandler('mcp:list-capabilities', test.layer)

    await handler?.({}, { projectPath: PROJECT_PATH, sessionId: 'session-1' })

    expect(test.browseCapabilities).toHaveBeenCalledWith({
      snapshot: expect.objectContaining({
        sessionId: 'session-1',
        runtimeNamespace: 'mcp-management:session-1',
      }),
    })
  })

  it('reconciles idle connections before returning a config mutation result', async () => {
    const test = makeTestLayer({ clearStatusesOnReconcile: true })
    const handler = getRegisteredHandler('mcp:set-scope-state', test.layer)

    const view = await handler?.(
      {},
      { projectPath: PROJECT_PATH, sessionId: 'session-1', scope: 'session', state: 'off' },
    )

    expect(test.reconcileIdleConnections).toHaveBeenCalledTimes(1)
    expect(view).toMatchObject({
      servers: [expect.objectContaining({ connectionState: 'disconnected' })],
    })
  })
})
