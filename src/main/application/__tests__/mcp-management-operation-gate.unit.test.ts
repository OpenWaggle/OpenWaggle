import type { McpCapabilityCatalog, McpSettingsView } from '@shared/types/mcp'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { server, snapshot } from '../../adapters/mcp/__tests__/mcp-runtime-test-utils'
import { McpConfigService, type McpConfigServiceShape } from '../../ports/mcp-config-service'
import { McpVaultError } from '../../ports/mcp-errors'
import { McpRuntimeService, type McpRuntimeServiceShape } from '../../ports/mcp-runtime-service'
import {
  McpSecretVaultService,
  type McpSecretVaultServiceShape,
} from '../../ports/mcp-secret-vault-service'
import {
  callMcpAppToolOperation,
  listMcpCapabilitiesOperation,
  readMcpResourceOperation,
} from '../mcp-capability-operations'
import { logoutMcpServerOperation, setMcpSecretOperation } from '../mcp-management-operations'

const EMPTY_CATALOG: McpCapabilityCatalog = {
  instructions: [],
  prompts: [],
  resources: [],
  resourceTemplates: [],
  apps: [],
  tasks: [],
  skills: [],
}

describe('MCP management operation gate', () => {
  it('holds a config snapshot read lease through its runtime operation and reconciliation', async () => {
    let releaseBrowse: (() => void) | undefined
    let reportBrowseStarted: (() => void) | undefined
    const browseStarted = new Promise<void>((resolve) => {
      reportBrowseStarted = resolve
    })
    const browseRelease = new Promise<void>((resolve) => {
      releaseBrowse = resolve
    })
    const browseCapabilities = vi.fn<McpRuntimeServiceShape['browseCapabilities']>(() =>
      Effect.promise(async () => {
        reportBrowseStarted?.()
        await browseRelease
        return EMPTY_CATALOG
      }),
    )
    const reconcileIdleConnections = vi.fn(() => Effect.void)
    const setSecret = vi.fn<McpSecretVaultServiceShape['set']>(() => Effect.succeed([]))
    const config = fromPartial<McpConfigServiceShape>({
      createTurnSnapshot: ({
        projectPath,
        sessionId,
      }: Parameters<McpConfigServiceShape['createTurnSnapshot']>[0]) =>
        Effect.succeed(snapshot({ projectPath, sessionId })),
    })
    const runtime = fromPartial<McpRuntimeServiceShape>({
      browseCapabilities,
      reconcileIdleConnections,
    })
    const vault = fromPartial<McpSecretVaultServiceShape>({ set: setSecret })
    const layer = Layer.mergeAll(
      Layer.succeed(McpConfigService, config),
      Layer.succeed(McpRuntimeService, runtime),
      Layer.succeed(McpSecretVaultService, vault),
    )

    const browsing = Effect.runPromise(
      Effect.provide(listMcpCapabilitiesOperation({ projectPath: process.cwd() }), layer),
    )
    await browseStarted
    const mutationSettled = vi.fn()
    const mutating = Effect.runPromise(
      Effect.provide(setMcpSecretOperation({ name: 'TOKEN', value: 'rotated' }), layer),
    ).then(mutationSettled)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mutationSettled).not.toHaveBeenCalled()
    expect(setSecret).not.toHaveBeenCalled()
    expect(reconcileIdleConnections).not.toHaveBeenCalled()

    releaseBrowse?.()
    await Promise.all([browsing, mutating])

    expect(setSecret).toHaveBeenCalledWith({ name: 'TOKEN', value: 'rotated' })
    expect(reconcileIdleConnections).toHaveBeenCalledOnce()
  })

  it('rejects MCP App operations after the approved server configuration changes', async () => {
    const browseCapabilities = vi.fn<McpRuntimeServiceShape['browseCapabilities']>()
    const readResource = vi.fn<McpRuntimeServiceShape['readResource']>()
    const callAppTool = vi.fn<McpRuntimeServiceShape['callAppTool']>()
    const config = fromPartial<McpConfigServiceShape>({
      createTurnSnapshot: ({
        projectPath,
        sessionId,
      }: Parameters<McpConfigServiceShape['createTurnSnapshot']>[0]) =>
        Effect.succeed(
          snapshot({
            projectPath,
            sessionId,
            servers: [server({ configHash: 'replacement-config' })],
          }),
        ),
    })
    const runtime = fromPartial<McpRuntimeServiceShape>({
      browseCapabilities,
      readResource,
      callAppTool,
    })
    const layer = Layer.mergeAll(
      Layer.succeed(McpConfigService, config),
      Layer.succeed(McpRuntimeService, runtime),
    )
    const context = {
      projectPath: process.cwd(),
      serverInstanceId: 'server-1',
      serverConfigHash: 'approved-config',
    }

    await expect(
      Effect.runPromise(Effect.provide(listMcpCapabilitiesOperation(context), layer)),
    ).rejects.toThrow('server configuration has changed')
    await expect(
      Effect.runPromise(
        Effect.provide(readMcpResourceOperation({ ...context, uri: 'ui://app' }), layer),
      ),
    ).rejects.toThrow('server configuration has changed')
    await expect(
      Effect.runPromise(
        Effect.provide(
          callMcpAppToolOperation({ ...context, toolName: 'write', arguments: {} }),
          layer,
        ),
      ),
    ).rejects.toThrow('server configuration has changed')

    expect(browseCapabilities).not.toHaveBeenCalled()
    expect(readResource).not.toHaveBeenCalled()
    expect(callAppTool).not.toHaveBeenCalled()
  })

  it('rejects MCP App tool calls that omit the approved server configuration hash', async () => {
    const callAppTool = vi.fn<McpRuntimeServiceShape['callAppTool']>()
    const config = fromPartial<McpConfigServiceShape>({
      createTurnSnapshot: ({
        projectPath,
        sessionId,
      }: Parameters<McpConfigServiceShape['createTurnSnapshot']>[0]) =>
        Effect.succeed(snapshot({ projectPath, sessionId })),
    })
    const runtime = fromPartial<McpRuntimeServiceShape>({ callAppTool })
    const layer = Layer.mergeAll(
      Layer.succeed(McpConfigService, config),
      Layer.succeed(McpRuntimeService, runtime),
    )

    await expect(
      Effect.runPromise(
        Effect.provide(
          callMcpAppToolOperation({
            projectPath: process.cwd(),
            serverInstanceId: 'server-1',
            toolName: 'write',
            arguments: {},
          }),
          layer,
        ),
      ),
    ).rejects.toThrow('serverConfigHash')
    expect(callAppTool).not.toHaveBeenCalled()
  })

  it('reconciles runtime clients after a partial logout mutation fails', async () => {
    const reconcileIdleConnections = vi.fn(() => Effect.void)
    const remove = vi
      .fn<McpSecretVaultServiceShape['remove']>()
      .mockImplementationOnce(() => Effect.succeed([]))
      .mockImplementationOnce(() =>
        Effect.fail(new McpVaultError({ reason: 'io', message: 'vault write failed' })),
      )
    const view = fromPartial<McpSettingsView>({
      projectPath: process.cwd(),
      sessionId: null,
      sources: [
        {
          id: 'project-standard',
          label: 'Project MCP',
          rawJson: JSON.stringify({
            mcpServers: {
              docs: {
                command: 'docs-mcp',
                env: {
                  A: { secret: 'SECRET_A' },
                  B: { secret: 'SECRET_B' },
                },
              },
            },
          }),
        },
      ],
      servers: [{ instanceId: 'server-1', name: 'docs', sourceId: 'project-standard' }],
    })
    const config = fromPartial<McpConfigServiceShape>({
      getServerDefinition: () =>
        Effect.succeed({
          instanceId: 'server-1',
          definition: {
            command: 'docs-mcp',
            env: {
              A: { secret: 'SECRET_A' },
              B: { secret: 'SECRET_B' },
            },
          },
        }),
      getView: () => Effect.succeed(view),
    })
    const runtime = fromPartial<McpRuntimeServiceShape>({ reconcileIdleConnections })
    const vault = fromPartial<McpSecretVaultServiceShape>({ remove })
    const layer = Layer.mergeAll(
      Layer.succeed(McpConfigService, config),
      Layer.succeed(McpRuntimeService, runtime),
      Layer.succeed(McpSecretVaultService, vault),
    )

    await expect(
      Effect.runPromise(
        Effect.provide(
          logoutMcpServerOperation({ projectPath: process.cwd(), instanceId: 'server-1' }),
          layer,
        ),
      ),
    ).rejects.toThrow('vault write failed')
    expect(remove).toHaveBeenCalledTimes(2)
    expect(reconcileIdleConnections).toHaveBeenCalledOnce()
  })
})
