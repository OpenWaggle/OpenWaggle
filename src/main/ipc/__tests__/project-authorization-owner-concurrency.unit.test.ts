import type * as FileSystem from 'node:fs/promises'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AgentAuthorizationScopeKey } from '@shared/types/agent-authorization-grants'
import type { HostBackedGuiChannel } from '@shared/types/host-ui-protocol'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invokeHost: vi.fn(),
  handle: vi.fn<(channel: string, listener: (...args: unknown[]) => unknown) => void>(),
  rename: vi.fn<typeof FileSystem.rename>(),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FileSystem>()
  mocks.rename.mockImplementation(actual.rename)
  return { ...actual, rename: mocks.rename, default: { ...actual, rename: mocks.rename } }
})
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }))
vi.mock('../../application/local-session-command-dispatcher', () => ({
  invokeConfiguredHostUiRaw: mocks.invokeHost,
}))
vi.mock('../../runtime', () => ({
  runAppEffect: (effect: Effect.Effect<unknown, unknown, never>) => Effect.runPromise(effect),
  runAppEffectExit: (effect: Effect.Effect<unknown, unknown, never>) =>
    Effect.runPromiseExit(effect),
}))

// Retain the GUI module graph while resetting imports for the independently started Host below.
import { registerProjectHandlers } from '../project-handler'

function deferred() {
  let resolve: (() => void) | undefined
  const promise = new Promise<void>((complete) => {
    resolve = complete
  })
  return { promise, resolve: () => resolve?.() }
}

function runOwner<A>(effect: Effect.Effect<A, unknown, unknown>) {
  // Deliberately omit unrelated Host services: a misrouted operation must fail for a missing port.
  return Effect.runPromise(fromAny<Effect.Effect<A, unknown, never>, typeof effect>(effect))
}

const originalKey: AgentAuthorizationScopeKey = {
  requester: 'MCP server',
  requesterId: 'server-a',
  capability: 'mcp.tool-call',
  resource: 'write',
}

describe('CLI-started Host and attached GUI project writes', () => {
  let projectPath = ''

  afterEach(async () => {
    await fs.rm(projectPath, { recursive: true, force: true })
  })

  it.each([
    { writer: 'preferences', edit: 'revoke' },
    { writer: 'project approval', edit: 'revoke' },
    { writer: 'preferences', edit: 'grant' },
    { writer: 'project approval', edit: 'grant' },
  ] as const)(
    'preserves the GUI $edit when the Host finishes an overlapping $writer write',
    async ({ writer, edit }) => {
      projectPath = await fs.realpath(
        await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-grant-owner-')),
      )
      vi.resetModules()
      const ownerConfig = await import('../../config/project-config')
      const ownerGrants = await import('../../application/agent-authorization-grants')
      const { dispatchHostUiRequest } = await import('../../application/host-ui-request-dispatcher')
      const actualFs = await vi.importActual<typeof FileSystem>('node:fs/promises')
      await ownerConfig.grantProjectAuthorization(projectPath, originalKey)
      const ownerReceived = deferred()
      mocks.handle.mockReset()
      mocks.invokeHost
        .mockReset()
        .mockImplementation(async (channel: HostBackedGuiChannel, args: readonly unknown[]) => {
          ownerReceived.resolve()
          const result = await runOwner(
            dispatchHostUiRequest({
              caller: { callerId: 'gui:local-user' },
              request: {
                contractVersion: 1,
                requestId: 'gui-grant-edit',
                channel,
                args: args.map((value) => ({ kind: 'value' as const, value })),
              },
            }),
          )
          return {
            handled: true,
            result:
              result.response.result.kind === 'undefined'
                ? undefined
                : result.response.result.value,
          }
        })
      registerProjectHandlers()
      const editChannel = `authorization-grants:${edit}` as const
      const editHandler = mocks.handle.mock.calls.find(([channel]) => channel === editChannel)?.[1]
      if (!editHandler) throw new Error(`Missing ${editChannel} IPC handler.`)

      const stagedWrite = deferred()
      const releaseWrite = deferred()
      mocks.rename.mockImplementationOnce(async (from, to) => {
        stagedWrite.resolve()
        await releaseWrite.promise
        await actualFs.rename(from, to)
      })
      const addedKey = { ...originalKey, requesterId: 'server-b' }
      const pendingOwnerWrite =
        writer === 'preferences'
          ? ownerConfig.setProjectPreferences(projectPath, { thinkingLevel: 'high' })
          : ownerGrants.grantForProject(projectPath, addedKey)
      await stagedWrite.promise
      const guiKey = edit === 'revoke' ? originalKey : { ...originalKey, requesterId: 'server-c' }
      const guiWrite = Promise.resolve(editHandler({ sender: {} }, projectPath, guiKey))
      try {
        // The old GUI completes its separate write; the fixed GUI reaches the owner and queues.
        // Either event gives a deterministic release without timers or an implementation-only hook.
        await Promise.race([guiWrite, ownerReceived.promise])
      } finally {
        releaseWrite.resolve()
        await Promise.all([pendingOwnerWrite, guiWrite])
      }

      const config = await ownerConfig.loadProjectConfig(projectPath)
      expect(config.preferences).toEqual(
        writer === 'preferences' ? { thinkingLevel: 'high' } : undefined,
      )
      const expectedKeys = [
        ...(edit === 'grant' ? [originalKey] : []),
        ...(writer === 'project approval' ? [addedKey] : []),
        ...(edit === 'grant' ? [guiKey] : []),
      ]
      expect(config.authorizationGrants ?? []).toEqual(
        expectedKeys.map((expectedKey) => ({ ...expectedKey, grantedAt: expect.any(Number) })),
      )
      expect(mocks.invokeHost).toHaveBeenCalledWith(editChannel, [projectPath, guiKey])
    },
  )
})
