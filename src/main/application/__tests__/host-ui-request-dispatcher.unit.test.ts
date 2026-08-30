import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { McpRuntimeService, type McpRuntimeServiceShape } from '../../ports/mcp-runtime-service'
import { McpSecretVaultService } from '../../ports/mcp-secret-vault-service'
import { SettingsService } from '../../services/settings-service'
import { dispatchHostUiRequest } from '../host-ui-request-dispatcher'

const settingsService = SettingsService.of({
  get: () => Effect.succeed(DEFAULT_SETTINGS),
  update: () => Effect.void,
  initialize: () => Effect.void,
  flushForTests: () => Effect.void,
})

const mcpSecretVaultService = McpSecretVaultService.of({
  list: () => Effect.succeed([]),
  resolve: () => Effect.fail(fromAny(new Error('not used'))),
  set: () => Effect.succeed([]),
  remove: () => Effect.succeed([]),
})

function request(channel: 'settings:get', args: readonly unknown[] = []) {
  return {
    contractVersion: 1,
    requestId: 'request-host-ui',
    channel,
    args: args.map((argument) =>
      argument === undefined
        ? { kind: 'undefined' as const }
        : { kind: 'value' as const, value: argument },
    ),
  } as const
}

function runWithoutRequirements<A>(effect: Effect.Effect<A, unknown, unknown>): Promise<A> {
  return Effect.runPromise(fromAny<Effect.Effect<A, unknown, never>, typeof effect>(effect))
}

describe('Host UI request dispatcher', () => {
  it('returns a correlated result for an authorized local GUI caller', async () => {
    const result = await runWithoutRequirements(
      dispatchHostUiRequest({
        caller: { callerId: 'gui:local-user' },
        request: request('settings:get'),
      }).pipe(Effect.provideService(SettingsService, settingsService)),
    )

    expect(result).toEqual({
      contract: 'host-ui-v1',
      response: {
        contractVersion: 1,
        requestId: 'request-host-ui',
        channel: 'settings:get',
        result: { kind: 'value', value: DEFAULT_SETTINGS },
      },
    })
  })

  it('rejects callers that merely claim another local Session identity', async () => {
    await expect(
      runWithoutRequirements(
        dispatchHostUiRequest({
          caller: { callerId: 'cli:external' },
          request: request('settings:get'),
        }),
      ),
    ).rejects.toThrow('only available to the local OpenWaggle GUI')
  })

  it('allows the authenticated local-machine CLI to invoke MCP owner operations', async () => {
    const result = await runWithoutRequirements(
      dispatchHostUiRequest({
        caller: { callerId: 'local-user:machine' },
        request: {
          contractVersion: 1,
          requestId: 'request-mcp-secrets',
          channel: 'mcp:list-secrets',
          args: [],
        },
      }).pipe(Effect.provideService(McpSecretVaultService, mcpSecretVaultService)),
    )

    expect(result).toMatchObject({
      contract: 'host-ui-v1',
      response: {
        requestId: 'request-mcp-secrets',
        channel: 'mcp:list-secrets',
        result: { kind: 'value', value: [] },
      },
    })
  })

  it('validates the Host transport argument count before executing an operation', async () => {
    await expect(
      runWithoutRequirements(
        dispatchHostUiRequest({
          caller: { callerId: 'gui:local-user' },
          request: request('settings:get', ['unexpected']),
        }).pipe(Effect.provideService(SettingsService, settingsService)),
      ),
    ).rejects.toThrow('Expected 0 Host UI arguments')
  })

  it('interrupts an in-flight Host operation when its client disconnects', async () => {
    const controller = new AbortController()
    const neverSettles = SettingsService.of({
      ...settingsService,
      get: () => Effect.never,
    })
    const pending = runWithoutRequirements(
      dispatchHostUiRequest({
        caller: { callerId: 'gui:local-user' },
        request: request('settings:get'),
        signal: controller.signal,
      }).pipe(Effect.provideService(SettingsService, neverSettles)),
    )

    controller.abort(new Error('client disconnected'))

    await expect(pending).rejects.toThrow('client disconnected')
  })

  it('finishes secret invalidation after a client disconnects during the durable write', async () => {
    let releaseWrite: (() => void) | undefined
    let reportWriteStarted: (() => void) | undefined
    const writeStarted = new Promise<void>((resolve) => {
      reportWriteStarted = resolve
    })
    const writeRelease = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    const vault = McpSecretVaultService.of({
      ...mcpSecretVaultService,
      set: () =>
        Effect.promise(async () => {
          reportWriteStarted?.()
          await writeRelease
          return []
        }),
    })
    const reconcileIdleConnections = vi.fn(() => Effect.void)
    const runtime = fromPartial<McpRuntimeServiceShape>({ reconcileIdleConnections })
    const controller = new AbortController()
    const pending = runWithoutRequirements(
      dispatchHostUiRequest({
        caller: { callerId: 'gui:local-user' },
        request: {
          contractVersion: 1,
          requestId: 'request-mcp-secret-write',
          channel: 'mcp:set-secret',
          args: [{ kind: 'value', value: { name: 'TOKEN', value: 'changed' } }],
        },
        signal: controller.signal,
      }).pipe(
        Effect.provideService(McpSecretVaultService, vault),
        Effect.provideService(McpRuntimeService, runtime),
      ),
    )

    await writeStarted
    controller.abort(new Error('client disconnected'))
    releaseWrite?.()

    await expect(pending).rejects.toThrow('client disconnected')
    expect(reconcileIdleConnections).toHaveBeenCalledOnce()
  })
})
