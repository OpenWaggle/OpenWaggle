import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { McpConfigService, type McpConfigServiceShape } from '../../ports/mcp-config-service'
import { McpRuntimeService, type McpRuntimeServiceShape } from '../../ports/mcp-runtime-service'
import {
  McpSecretVaultService,
  type McpSecretVaultServiceShape,
} from '../../ports/mcp-secret-vault-service'

const mocks = vi.hoisted(() => ({ authorize: vi.fn() }))

vi.mock('../../adapters/mcp/oauth-provider', () => ({ authorizeMcpServer: mocks.authorize }))
vi.mock('../../desktop-ui', () => ({ openExternal: vi.fn() }))

import { authorizeMcpServerOperation } from '../mcp-authorization-operation'
import { setMcpSecretOperation } from '../mcp-management-operations'

describe('MCP authorization identity lease', () => {
  it('resolves the server definition inside the same writer lease as credential commits', async () => {
    let releaseDefinition!: () => void
    let reportDefinitionRead!: () => void
    const definitionStarted = new Promise<void>((resolve) => {
      reportDefinitionRead = resolve
    })
    const definitionRelease = new Promise<void>((resolve) => {
      releaseDefinition = resolve
    })
    const setSecret = vi.fn<McpSecretVaultServiceShape['set']>(() => Effect.succeed([]))
    const config = fromPartial<McpConfigServiceShape>({
      getServerDefinition: () =>
        Effect.promise(async () => {
          reportDefinitionRead()
          await definitionRelease
          return {
            instanceId: 'server-1',
            definition: { url: 'https://docs.example.com/mcp', auth: { type: 'oauth' } },
          }
        }),
    })
    const runtime = fromPartial<McpRuntimeServiceShape>({
      reconcileIdleConnections: () => Effect.void,
    })
    const vault = fromPartial<McpSecretVaultServiceShape>({
      resolve: () => Effect.succeed('token'),
      set: setSecret,
      remove: () => Effect.succeed([]),
    })
    const layer = Layer.mergeAll(
      Layer.succeed(McpConfigService, config),
      Layer.succeed(McpRuntimeService, runtime),
      Layer.succeed(McpSecretVaultService, vault),
    )
    mocks.authorize.mockResolvedValueOnce({ authorized: true, browserOpened: false })

    const authorizing = Effect.runPromise(
      Effect.provide(
        authorizeMcpServerOperation({ projectPath: process.cwd(), instanceId: 'server-1' }),
        layer,
      ),
    )
    await definitionStarted
    const mutation = Effect.runPromise(
      Effect.provide(setMcpSecretOperation({ name: 'TOKEN', value: 'replacement' }), layer),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(setSecret).not.toHaveBeenCalled()
    releaseDefinition()
    await Promise.all([authorizing, mutation])
    expect(setSecret).toHaveBeenCalledWith({ name: 'TOKEN', value: 'replacement' })
  })

  it('aborts a disconnected authorization and releases the management writer', async () => {
    let authorizationSignal: AbortSignal | undefined
    const authorizationStarted = new Promise<void>((resolve) => {
      mocks.authorize.mockImplementationOnce(
        ({ signal }: { readonly signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            authorizationSignal = signal
            signal?.addEventListener(
              'abort',
              () => reject(signal.reason ?? new Error('cancelled')),
              { once: true },
            )
            resolve()
          }),
      )
    })
    const setSecret = vi.fn<McpSecretVaultServiceShape['set']>(() => Effect.succeed([]))
    const config = fromPartial<McpConfigServiceShape>({
      getServerDefinition: () =>
        Effect.succeed({
          instanceId: 'server-cancel',
          definition: { url: 'https://docs.example.com/mcp', auth: { type: 'oauth' } },
        }),
    })
    const runtime = fromPartial<McpRuntimeServiceShape>({
      reconcileIdleConnections: () => Effect.void,
    })
    const vault = fromPartial<McpSecretVaultServiceShape>({
      resolve: () => Effect.fail(new Error('secret was not found')),
      set: setSecret,
      remove: () => Effect.succeed([]),
    })
    const layer = Layer.mergeAll(
      Layer.succeed(McpConfigService, config),
      Layer.succeed(McpRuntimeService, runtime),
      Layer.succeed(McpSecretVaultService, vault),
    )
    const fiber = Effect.runFork(
      Effect.provide(
        authorizeMcpServerOperation({ projectPath: process.cwd(), instanceId: 'server-cancel' }),
        layer,
      ),
    )
    await authorizationStarted

    await Effect.runPromise(Fiber.interrupt(fiber))
    expect(authorizationSignal?.aborted).toBe(true)
    await expect(
      Effect.runPromise(
        Effect.provide(setMcpSecretOperation({ name: 'TOKEN', value: 'replacement' }), layer),
      ),
    ).resolves.toEqual([])
    expect(setSecret).toHaveBeenCalledWith({ name: 'TOKEN', value: 'replacement' })
  })
})
