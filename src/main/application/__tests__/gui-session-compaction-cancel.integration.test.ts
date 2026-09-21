import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { decodeLocalSessionCommandPayload } from '@shared/schemas/local-session-protocol'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
import { reserveCompactionSessionWriter } from '../active-session-runs'
import {
  configureGuiSessionCommandClient,
  dispatchConfiguredGuiSessionCommand,
} from '../local-session-command-dispatcher'
import { executeManualSessionCompactionCancellation } from '../manual-session-compaction-service'

describe('GUI Session Host compaction cancellation client', () => {
  let temporaryRoot = ''
  let runtime: LocalSessionHostRuntime | null = null
  let endpointDirectory: string | null = null

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-gui-compact-cancel-'))
  })

  afterEach(async () => {
    configureGuiSessionCommandClient(null)
    await runtime?.stop()
    if (endpointDirectory) await fs.rm(endpointDirectory, { recursive: true, force: true })
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('cancels an active compaction through the detached owning Session Host', async () => {
    const paths = resolveLocalSessionHostPaths({ userDataRoot: temporaryRoot })
    endpointDirectory = paths.endpointDirectory === paths.stateRoot ? null : paths.endpointDirectory
    await prepareLocalSessionHostPaths(paths)
    const credential = await ensureLocalUserCredential(paths.credentialPath)
    runtime = await startLocalSessionHost({
      endpoint: paths.endpoint,
      databasePath: paths.databasePath,
      idleGracePeriodMs: 60_000,
      authenticate: createLocalSessionAuthenticator({ localUserCredential: credential }),
      dispatch: ({ caller, payload: undecodedPayload }) => {
        const payload = decodeLocalSessionCommandPayload(undecodedPayload)
        if (payload.contract !== 'local-compaction-cancel-v1') {
          throw new Error('Expected a compaction cancellation command.')
        }
        return Effect.runPromise(executeManualSessionCompactionCancellation({ caller, payload }))
      },
    })
    configureGuiSessionCommandClient({ paths, clientVersion: 'test' })
    const controller = new AbortController()
    const writer = reserveCompactionSessionWriter(
      SessionId('session-remote'),
      controller,
      SupportedModelId('openai/gpt-5.5'),
    )

    try {
      const remote = dispatchConfiguredGuiSessionCommand({
        caller: { callerId: 'gui:local-user' },
        payload: {
          contract: 'local-compaction-cancel-v1',
          request: { requestId: 'gui-compact-cancel', sessionId: 'session-remote' },
        },
      })
      if (!remote) throw new Error('Expected the configured GUI Session client.')

      await expect(Effect.runPromise(remote)).resolves.toEqual({
        contract: 'local-compaction-cancel-v1',
        response: {
          requestId: 'gui-compact-cancel',
          sessionId: 'session-remote',
          cancelled: true,
        },
      })
      expect(controller.signal.aborted).toBe(true)
    } finally {
      writer.release()
    }
  })
})
