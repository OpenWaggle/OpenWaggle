import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
import {
  configureGuiSessionCommandClient,
  dispatchConfiguredGuiSessionCommand,
} from '../local-session-command-dispatcher'

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
})
