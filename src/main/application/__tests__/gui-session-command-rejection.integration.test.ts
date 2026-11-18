import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalSessionAuthenticator } from '../../session-host/local-session-authenticator'
import { LocalSessionClientProtocolError } from '../../session-host/local-session-client-protocol-error'
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

describe('GUI Session Host command rejection', () => {
  let temporaryRoot = ''
  let runtime: LocalSessionHostRuntime | null = null
  let endpointDirectory: string | null = null

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-gui-host-rejection-'))
  })

  afterEach(async () => {
    configureGuiSessionCommandClient(null)
    await runtime?.stop()
    if (endpointDirectory) await fs.rm(endpointDirectory, { recursive: true, force: true })
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('surfaces the owning Host rejection reason for manual compaction', async () => {
    const paths = resolveLocalSessionHostPaths({ userDataRoot: temporaryRoot })
    endpointDirectory = paths.endpointDirectory === paths.stateRoot ? null : paths.endpointDirectory
    await prepareLocalSessionHostPaths(paths)
    const credential = await ensureLocalUserCredential(paths.credentialPath)
    runtime = await startLocalSessionHost({
      endpoint: paths.endpoint,
      databasePath: paths.databasePath,
      idleGracePeriodMs: 60_000,
      authenticate: createLocalSessionAuthenticator({ localUserCredential: credential }),
      dispatch: async () => {
        throw new Error('Nothing to compact (session too small)')
      },
    })
    configureGuiSessionCommandClient({ paths, clientVersion: 'test' })

    const remote = dispatchConfiguredGuiSessionCommand({
      caller: { callerId: 'gui:local-user' },
      payload: {
        contract: 'local-compaction-v1',
        request: {
          requestId: 'gui-compact-small',
          sessionId: 'session-1',
          model: 'openai/gpt-5.5',
        },
      },
    })
    if (!remote) throw new Error('Expected the configured GUI Session client.')

    const failure = await Effect.runPromise(Effect.flip(remote))
    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({
      message: 'Nothing to compact (session too small)',
      cause: expect.any(LocalSessionClientProtocolError),
    })
  })
})
