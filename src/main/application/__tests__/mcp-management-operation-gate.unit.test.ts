import type { McpCapabilityCatalog } from '@shared/types/mcp'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { snapshot } from '../../adapters/mcp/__tests__/mcp-runtime-test-utils'
import { McpConfigService, type McpConfigServiceShape } from '../../ports/mcp-config-service'
import { McpRuntimeService, type McpRuntimeServiceShape } from '../../ports/mcp-runtime-service'
import {
  McpSecretVaultService,
  type McpSecretVaultServiceShape,
} from '../../ports/mcp-secret-vault-service'
import { listMcpCapabilitiesOperation } from '../mcp-capability-operations'
import { setMcpSecretOperation } from '../mcp-management-operations'

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
})
