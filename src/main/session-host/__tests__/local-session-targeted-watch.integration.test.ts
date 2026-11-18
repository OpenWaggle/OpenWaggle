import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalSessionAuthenticator } from '../local-session-authenticator'
import { watchLocalSessionEvents } from '../local-session-client'
import { type LocalSessionHostRuntime, startLocalSessionHost } from '../local-session-host-runtime'
import { prepareLocalSessionHostPaths, resolveLocalSessionHostPaths } from '../local-session-paths'
import { ensureLocalUserCredential } from '../local-user-credential'

describe('Local Session targeted watch', () => {
  let temporaryRoot = ''
  let runtime: LocalSessionHostRuntime | null = null
  let fallbackEndpointDirectory: string | null = null

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-targeted-watch-'))
  })

  afterEach(async () => {
    await runtime?.stop()
    if (fallbackEndpointDirectory) {
      await fs.rm(fallbackEndpointDirectory, { recursive: true, force: true })
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('filters before unrelated events consume subscription capacity', async () => {
    const paths = resolveLocalSessionHostPaths({
      userDataRoot: temporaryRoot,
      temporaryRoot: '/tmp',
      platform: 'darwin',
    })
    await prepareLocalSessionHostPaths(paths)
    fallbackEndpointDirectory =
      paths.endpointDirectory === paths.stateRoot ? null : paths.endpointDirectory
    const credential = await ensureLocalUserCredential(paths.credentialPath)
    runtime = await startLocalSessionHost({
      endpoint: paths.endpoint,
      databasePath: paths.databasePath,
      idleGracePeriodMs: 60_000,
      subscriberCapacity: 1,
      authenticate: createLocalSessionAuthenticator({ localUserCredential: credential }),
      dispatch: async () => ({ accepted: true }),
      snapshotActiveRuns: () =>
        ['session-target', 'session-unrelated'].map((sessionId) => ({
          sessionId: SessionId(sessionId),
          model: SupportedModelId('provider/model'),
          activity: 'agent-run' as const,
          activityEvents: [],
          mode: 'classic' as const,
          startedAt: 1,
          parts: [],
        })),
    })
    const abortController = new AbortController()
    const events: unknown[] = []
    const snapshots: unknown[] = []
    const watching = watchLocalSessionEvents({
      paths,
      clientVersion: 'test',
      sessionIds: ['session-target'],
      signal: abortController.signal,
      onSnapshot: (activeRuns) => {
        snapshots.push(activeRuns)
      },
      onEvent: (event) => {
        events.push(event)
        abortController.abort()
      },
    })
    for (let attempt = 0; attempt < 50 && runtime.eventHub.subscriberCount() === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    for (let index = 0; index < 10; index += 1) {
      runtime.eventHub.publish({
        kind: 'session-state-changed',
        sessionId: 'session-unrelated',
        stateRevision: index,
        operation: 'message',
      })
    }
    runtime.eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-target',
      stateRevision: 1,
      operation: 'message',
    })

    await expect(watching).resolves.toEqual({ status: 'closed' })
    expect(events).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ sessionId: 'session-target' }),
      }),
    ])
    expect(snapshots).toEqual([
      [expect.objectContaining({ sessionId: SessionId('session-target') })],
    ])
  })
})
