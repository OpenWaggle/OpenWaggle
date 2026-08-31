import { HOST_BACKED_MCP_GUI_CHANNELS } from '@shared/types/host-ui-protocol'
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
import {
  McpSecretVaultService,
  type McpSecretVaultServiceShape,
} from '../../ports/mcp-secret-vault-service'

const {
  authorizeMcpServerMock,
  hostHandleMock,
  reconcileConfiguredMcpOwnerRuntimeMock,
  typedHandleMock,
} = vi.hoisted(() => ({
  authorizeMcpServerMock: vi.fn(),
  hostHandleMock: vi.fn(),
  reconcileConfiguredMcpOwnerRuntimeMock: vi.fn(),
  typedHandleMock: vi.fn(),
}))

vi.mock('../../adapters/mcp/oauth-provider', () => ({
  authorizeMcpServer: authorizeMcpServerMock,
}))
vi.mock('../../application/gui-session-command-router', () => ({
  reconcileConfiguredMcpOwnerRuntime: reconcileConfiguredMcpOwnerRuntimeMock,
}))

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }))
vi.mock('../typed-ipc', () => ({ hostHandle: hostHandleMock, typedHandle: typedHandleMock }))

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
      projectEnabled: true,
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
  projectStates: {},
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
    getServerDefinition: () =>
      Effect.succeed({
        instanceId: 'server-1',
        definition: {
          url: 'https://docs.example.com/mcp',
          auth: { type: 'oauth' as const },
        },
      }),
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
  const setSecret = vi.fn<McpSecretVaultServiceShape['set']>(() => Effect.succeed([]))
  const removeSecret = vi.fn<McpSecretVaultServiceShape['remove']>(() => Effect.succeed([]))
  const vault = fromPartial<McpSecretVaultServiceShape>({
    list: () => Effect.succeed([]),
    set: setSecret,
    remove: removeSecret,
  })
  return {
    layer: Layer.mergeAll(
      Layer.succeed(McpConfigService, config),
      Layer.succeed(McpRuntimeService, runtime),
      Layer.succeed(McpSecretVaultService, vault),
    ),
    reconcileIdleConnections,
    browseCapabilities,
    removeSecret,
    setSecret,
  }
}

function getRegisteredHandler(name: string, layer: ReturnType<typeof makeTestLayer>['layer']) {
  const call = [...hostHandleMock.mock.calls, ...typedHandleMock.mock.calls].find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') return undefined
  return (...args: unknown[]) => Effect.runPromise(Effect.provide(handler(...args), layer))
}

describe('MCP IPC runtime settings lifecycle', () => {
  beforeEach(() => {
    hostHandleMock.mockReset()
    typedHandleMock.mockReset()
    authorizeMcpServerMock.mockReset()
    authorizeMcpServerMock.mockImplementation(
      async (input: { vault: { set(name: string, value: string): Promise<unknown> } }) => {
        await input.vault.set('oauth.server-1', 'changed-token')
        return { authorized: true, browserOpened: false }
      },
    )
    reconcileConfiguredMcpOwnerRuntimeMock.mockReset()
    reconcileConfiguredMcpOwnerRuntimeMock.mockResolvedValue(true)
    registerMcpHandlers()
  })

  it('routes runtime MCP handlers through the Host while keeping browser OAuth local', () => {
    const hostChannels = hostHandleMock.mock.calls.map((call) => call[0])
    const localChannels = typedHandleMock.mock.calls.map((call) => call[0])

    expect(new Set(hostChannels)).toEqual(new Set(HOST_BACKED_MCP_GUI_CHANNELS))
    expect(localChannels).toEqual(['mcp:authorize-server'])
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
    expect(test.reconcileIdleConnections).not.toHaveBeenCalled()
  })

  it('reconciles the owner when settings explicitly carry a mutation notification', async () => {
    const test = makeTestLayer()
    const handler = getRegisteredHandler('mcp:get-settings', test.layer)

    await handler?.({}, { projectPath: PROJECT_PATH, reconcileRuntime: true })

    expect(test.reconcileIdleConnections).toHaveBeenCalledOnce()
  })

  it('notifies the owning Host after browser OAuth changes the shared vault', async () => {
    const test = makeTestLayer()
    const handler = getRegisteredHandler('mcp:authorize-server', test.layer)

    await handler?.({}, { projectPath: PROJECT_PATH, instanceId: 'server-1' })

    expect(reconcileConfiguredMcpOwnerRuntimeMock).toHaveBeenCalledWith(PROJECT_PATH)
    expect(test.reconcileIdleConnections).not.toHaveBeenCalled()
  })

  it('notifies the owner when browser OAuth mutates the vault before failing', async () => {
    const test = makeTestLayer()
    const handler = getRegisteredHandler('mcp:authorize-server', test.layer)
    authorizeMcpServerMock.mockImplementationOnce(
      async (input: { vault: { remove(name: string): Promise<unknown> } }) => {
        await input.vault.remove('oauth.server-1')
        throw new Error('OAuth callback cancelled')
      },
    )

    await expect(
      handler?.({}, { projectPath: PROJECT_PATH, instanceId: 'server-1' }),
    ).rejects.toThrow('OAuth callback cancelled')

    expect(reconcileConfiguredMcpOwnerRuntimeMock).toHaveBeenCalledWith(PROJECT_PATH)
  })

  it('retries owner reconciliation when OAuth already persisted authorization', async () => {
    const test = makeTestLayer()
    const handler = getRegisteredHandler('mcp:authorize-server', test.layer)
    authorizeMcpServerMock
      .mockImplementationOnce(
        async (input: { vault: { set(name: string, value: string): Promise<unknown> } }) => {
          await input.vault.set('oauth.server-1', 'changed-token')
          return { authorized: true, browserOpened: false }
        },
      )
      .mockResolvedValueOnce({ authorized: true, browserOpened: false })
    reconcileConfiguredMcpOwnerRuntimeMock
      .mockRejectedValueOnce(new Error('owner connection reset'))
      .mockResolvedValueOnce(true)

    await expect(
      handler?.({}, { projectPath: PROJECT_PATH, instanceId: 'server-1' }),
    ).rejects.toThrow('owner connection reset')
    await expect(
      handler?.({}, { projectPath: PROJECT_PATH, instanceId: 'server-1' }),
    ).resolves.toEqual({ authorized: true, browserOpened: false })

    expect(reconcileConfiguredMcpOwnerRuntimeMock).toHaveBeenCalledTimes(2)
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

  it('invalidates idle owner connections after secret changes and OAuth logout', async () => {
    const test = makeTestLayer()
    const setSecret = getRegisteredHandler('mcp:set-secret', test.layer)
    const removeSecret = getRegisteredHandler('mcp:remove-secret', test.layer)
    const logout = getRegisteredHandler('mcp:logout-server', test.layer)

    await setSecret?.({}, { name: 'TOKEN', value: 'changed' })
    await removeSecret?.({}, { name: 'STALE_TOKEN' })
    await logout?.({}, { projectPath: PROJECT_PATH, instanceId: 'server-1' })

    expect(test.setSecret).toHaveBeenCalledWith({ name: 'TOKEN', value: 'changed' })
    expect(test.removeSecret).toHaveBeenNthCalledWith(1, { name: 'STALE_TOKEN' })
    expect(test.removeSecret).toHaveBeenNthCalledWith(2, { name: 'oauth.server-1' })
    expect(test.reconcileIdleConnections).toHaveBeenCalledTimes(3)
  })
})
