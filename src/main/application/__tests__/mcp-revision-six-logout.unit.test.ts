import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { McpOAuthServiceLive } from '../../adapters/mcp/mcp-oauth-service'
import { McpConfigService, type McpConfigServiceShape } from '../../ports/mcp-config-service'
import { McpVaultError } from '../../ports/mcp-errors'
import { McpRuntimeService, type McpRuntimeServiceShape } from '../../ports/mcp-runtime-service'
import {
  McpSecretVaultService,
  type McpSecretVaultServiceShape,
} from '../../ports/mcp-secret-vault-service'
import { withMcpManagementWrite } from '../mcp-management-operation-gate'
import { logoutMcpServerRevision6Operation } from '../mcp-management-operations'

function operationLayer(input: {
  readonly getServerDefinition: McpConfigServiceShape['getServerDefinition']
  readonly reconcileIdleConnections: McpRuntimeServiceShape['reconcileIdleConnections']
  readonly remove: McpSecretVaultServiceShape['remove']
}) {
  const vaultLayer = Layer.succeed(
    McpSecretVaultService,
    fromPartial<McpSecretVaultServiceShape>({ remove: input.remove }),
  )
  return Layer.mergeAll(
    Layer.succeed(
      McpConfigService,
      fromPartial<McpConfigServiceShape>({ getServerDefinition: input.getServerDefinition }),
    ),
    Layer.succeed(
      McpRuntimeService,
      fromPartial<McpRuntimeServiceShape>({
        reconcileIdleConnections: input.reconcileIdleConnections,
      }),
    ),
    vaultLayer,
    McpOAuthServiceLive.pipe(Layer.provide(vaultLayer)),
  )
}

function logout(layer: ReturnType<typeof operationLayer>, instanceId: string) {
  return Effect.runPromise(
    Effect.provide(
      logoutMcpServerRevision6Operation({ projectPath: process.cwd(), instanceId }),
      layer,
    ),
  )
}

describe('revision-six MCP logout', () => {
  it('reconciles runtime clients when OAuth vault removal fails', async () => {
    const reconcileIdleConnections = vi.fn(() => Effect.void)
    const remove = vi.fn<McpSecretVaultServiceShape['remove']>(() =>
      Effect.fail(new McpVaultError({ reason: 'io', message: 'OAuth removal failed' })),
    )
    const getServerDefinition = vi.fn(() =>
      Effect.succeed({
        instanceId: 'server-revision-six-failure',
        definition: { url: 'https://docs.example.com/mcp', auth: { type: 'oauth' as const } },
      }),
    )
    const layer = operationLayer({ getServerDefinition, reconcileIdleConnections, remove })

    await expect(logout(layer, 'server-revision-six-failure')).rejects.toThrow(
      'OAuth removal failed',
    )
    expect(remove).toHaveBeenCalledOnce()
    expect(reconcileIdleConnections).toHaveBeenCalledOnce()
  })

  it('reads the target only after entering the management writer lease', async () => {
    let releaseWriter: (() => void) | undefined
    let reportWriterStarted: (() => void) | undefined
    const writerStarted = new Promise<void>((resolve) => {
      reportWriterStarted = resolve
    })
    const writer = Effect.runPromise(
      withMcpManagementWrite(
        Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              releaseWriter = resolve
              reportWriterStarted?.()
            }),
        ),
      ),
    )
    await writerStarted

    const getServerDefinition = vi.fn(() =>
      Effect.succeed({
        instanceId: 'server-revision-six-serialized',
        definition: { url: 'https://docs.example.com/mcp', auth: { type: 'oauth' as const } },
      }),
    )
    const layer = operationLayer({
      getServerDefinition,
      reconcileIdleConnections: () => Effect.void,
      remove: () => Effect.succeed([]),
    })
    const pendingLogout = logout(layer, 'server-revision-six-serialized')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(getServerDefinition).not.toHaveBeenCalled()

    releaseWriter?.()
    await Promise.all([writer, pendingLogout])
    expect(getServerDefinition).toHaveBeenCalledOnce()
  })
})
