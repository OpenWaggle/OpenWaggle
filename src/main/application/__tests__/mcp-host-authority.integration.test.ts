import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { toHostUiJsonValue } from '@shared/host-ui-json'
import { decodeLocalSessionCommandPayloadForRevision } from '@shared/schemas/local-session-protocol'
import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { snapshot } from '../../adapters/mcp/__tests__/mcp-runtime-test-utils'
import { mcpOAuthVaultKey } from '../../domain/mcp/oauth-vault-key'
import { McpConfigService, type McpConfigServiceShape } from '../../ports/mcp-config-service'
import { McpRuntimeService, type McpRuntimeServiceShape } from '../../ports/mcp-runtime-service'
import {
  McpSecretVaultService,
  type McpSecretVaultServiceShape,
} from '../../ports/mcp-secret-vault-service'
import { createLocalSessionAuthenticator } from '../../session-host/local-session-authenticator'
import {
  type LocalSessionHostRuntime,
  startLocalSessionHost,
} from '../../session-host/local-session-host-runtime'
import {
  prepareLocalSessionHostPaths,
  resolveLocalSessionHostPaths,
} from '../../session-host/local-session-paths'
import { ensureLocalUserCredential } from '../../session-host/local-user-credential'
import { executeHostUi } from '../configured-host-ui-client'
import {
  configureGuiSessionCommandClient,
  dispatchConfiguredGuiSessionCommand,
} from '../local-session-command-dispatcher'
import { listMcpCapabilitiesOperation } from '../mcp-capability-operations'
import {
  logoutMcpServerRevision6Operation,
  setMcpSecretOperation,
} from '../mcp-management-operations'

describe('MCP Host authority', () => {
  let temporaryRoot = ''
  let runtime: LocalSessionHostRuntime | null = null
  let endpointDirectory: string | null = null

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-mcp-host-authority-'))
  })

  afterEach(async () => {
    configureGuiSessionCommandClient(null)
    await runtime?.stop()
    if (endpointDirectory) await fs.rm(endpointDirectory, { recursive: true, force: true })
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('routes MCP management to the detached owning Session Host', async () => {
    const paths = resolveLocalSessionHostPaths({ userDataRoot: temporaryRoot })
    endpointDirectory = paths.endpointDirectory === paths.stateRoot ? null : paths.endpointDirectory
    await prepareLocalSessionHostPaths(paths)
    const credential = await ensureLocalUserCredential(paths.credentialPath)
    const ownerDispatch = vi.fn(async ({ payload }) => ({
      contract: 'host-ui-v1' as const,
      response: {
        contractVersion: 1 as const,
        requestId:
          payload.contract === 'host-ui-v1' ? payload.request.requestId : 'unexpected-request',
        channel: 'mcp:get-settings' as const,
        result: { kind: 'value' as const, value: { projectPath: '/owner/project' } },
      },
    }))
    runtime = await startLocalSessionHost({
      endpoint: paths.endpoint,
      databasePath: paths.databasePath,
      idleGracePeriodMs: 60_000,
      authenticate: createLocalSessionAuthenticator({ localUserCredential: credential }),
      dispatch: ownerDispatch,
    })
    configureGuiSessionCommandClient({ paths, clientVersion: 'test' })

    const remote = dispatchConfiguredGuiSessionCommand({
      caller: { callerId: 'gui:local-user' },
      payload: {
        contract: 'host-ui-v1',
        request: {
          contractVersion: 1,
          requestId: 'gui-mcp-settings',
          channel: 'mcp:get-settings',
          args: [
            { kind: 'value', value: { projectPath: '/owner/project', sessionId: 'session-owner' } },
          ],
        },
      },
    })
    if (!remote) throw new Error('Expected the configured GUI Session client.')

    await expect(Effect.runPromise(remote)).resolves.toMatchObject({
      contract: 'host-ui-v1',
      response: {
        channel: 'mcp:get-settings',
        result: { kind: 'value', value: { projectPath: '/owner/project' } },
      },
    })
    expect(ownerDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        caller: { callerId: 'gui:local-user' },
        negotiatedRevision: LOCAL_SESSION_CURRENT_REVISION,
        payload: expect.objectContaining({
          contract: 'host-ui-v1',
          request: expect.objectContaining({ channel: 'mcp:get-settings' }),
        }),
      }),
    )
  })

  it('holds owner-process MCP mutations behind an in-flight request from another client', async () => {
    const paths = resolveLocalSessionHostPaths({ userDataRoot: temporaryRoot })
    endpointDirectory = paths.endpointDirectory === paths.stateRoot ? null : paths.endpointDirectory
    await prepareLocalSessionHostPaths(paths)
    const credential = await ensureLocalUserCredential(paths.credentialPath)
    let releaseBrowse!: () => void
    let reportBrowseStarted!: () => void
    const browseStarted = new Promise<void>((resolve) => {
      reportBrowseStarted = resolve
    })
    const browseRelease = new Promise<void>((resolve) => {
      releaseBrowse = resolve
    })
    let persistedSecret: string | null = null
    const config = fromPartial<McpConfigServiceShape>({
      createTurnSnapshot: (input: Parameters<McpConfigServiceShape['createTurnSnapshot']>[0]) =>
        Effect.succeed(snapshot({ projectPath: input.projectPath, sessionId: input.sessionId })),
    })
    const mcpRuntime = fromPartial<McpRuntimeServiceShape>({
      browseCapabilities: () =>
        Effect.promise(async () => {
          reportBrowseStarted()
          await browseRelease
          return {
            instructions: [],
            prompts: [],
            resources: [],
            resourceTemplates: [],
            apps: [],
            tasks: [],
            skills: [],
          }
        }),
      reconcileIdleConnections: () => Effect.void,
    })
    const vault = fromPartial<McpSecretVaultServiceShape>({
      set: (input: Parameters<McpSecretVaultServiceShape['set']>[0]) =>
        Effect.sync(() => {
          persistedSecret = input.value
          return []
        }),
    })
    const layer = Layer.mergeAll(
      Layer.succeed(McpConfigService, config),
      Layer.succeed(McpRuntimeService, mcpRuntime),
      Layer.succeed(McpSecretVaultService, vault),
    )
    runtime = await startLocalSessionHost({
      endpoint: paths.endpoint,
      databasePath: paths.databasePath,
      idleGracePeriodMs: 60_000,
      authenticate: createLocalSessionAuthenticator({ localUserCredential: credential }),
      dispatch: ({ payload, negotiatedRevision }) => {
        const command = decodeLocalSessionCommandPayloadForRevision(payload, negotiatedRevision)
        if (command.contract !== 'host-ui-v1') throw new Error('Expected a Host UI request.')
        const argument = command.request.args[0]
        const input = argument?.kind === 'value' ? argument.value : undefined
        const operation: Promise<unknown> =
          command.request.channel === 'mcp:list-capabilities'
            ? Effect.runPromise(Effect.provide(listMcpCapabilitiesOperation(input), layer))
            : command.request.channel === 'mcp:set-secret'
              ? Effect.runPromise(Effect.provide(setMcpSecretOperation(input), layer))
              : Promise.reject(new Error('Unexpected MCP Host UI channel.'))
        return operation.then((result) => ({
          contract: 'host-ui-v1' as const,
          response: {
            contractVersion: command.request.contractVersion,
            requestId: command.request.requestId,
            channel: command.request.channel,
            result: { kind: 'value' as const, value: toHostUiJsonValue(result) },
          },
        }))
      },
    })
    const client = { paths, clientKind: 'cli' as const, clientVersion: 'test' }

    const browsing = executeHostUi({
      client,
      channel: 'mcp:list-capabilities',
      args: [{ projectPath: process.cwd() }],
    })
    await browseStarted
    const mutationSettled = vi.fn()
    const mutating = executeHostUi({
      client,
      channel: 'mcp:set-secret',
      args: [{ name: 'TOKEN', value: 'rotated' }],
    }).then(mutationSettled)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(persistedSecret).toBeNull()
    expect(mutationSettled).not.toHaveBeenCalled()
    releaseBrowse()
    await Promise.all([browsing, mutating])
    expect(persistedSecret).toBe('rotated')
  })

  it('preserves revision-six OAuth-only logout semantics and result shape', async () => {
    const remove = vi.fn<McpSecretVaultServiceShape['remove']>(() => Effect.succeed([]))
    const reconcileIdleConnections = vi.fn(() => Effect.void)
    const config = fromPartial<McpConfigServiceShape>({
      getServerDefinition: () =>
        Effect.succeed({
          instanceId: 'server-legacy-logout',
          definition: { url: 'https://docs.example.com/mcp', auth: { type: 'oauth' } },
        }),
    })
    const mcpRuntime = fromPartial<McpRuntimeServiceShape>({ reconcileIdleConnections })
    const vault = fromPartial<McpSecretVaultServiceShape>({ remove })
    const result = await Effect.runPromise(
      logoutMcpServerRevision6Operation({
        projectPath: process.cwd(),
        instanceId: 'server-legacy-logout',
      }).pipe(
        Effect.provideService(McpConfigService, config),
        Effect.provideService(McpRuntimeService, mcpRuntime),
        Effect.provideService(McpSecretVaultService, vault),
      ),
    )

    expect(result).toEqual({ loggedOut: true })
    expect(remove).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith({ name: mcpOAuthVaultKey('server-legacy-logout') })
    expect(reconcileIdleConnections).toHaveBeenCalledOnce()
  })
})
