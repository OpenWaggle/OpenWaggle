import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalSessionAuthenticator } from '../local-session-authenticator'
import { watchLocalSessionEvents } from '../local-session-client'
import { type LocalSessionHostRuntime, startLocalSessionHost } from '../local-session-host-runtime'
import { prepareLocalSessionHostPaths, resolveLocalSessionHostPaths } from '../local-session-paths'
import { ensureLocalUserCredential } from '../local-user-credential'

describe('Local Session snapshot boundary', () => {
  let temporaryRoot = ''
  let runtime: LocalSessionHostRuntime | null = null
  let fallbackEndpointDirectory: string | null = null

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-snapshot-boundary-'))
  })

  afterEach(async () => {
    await runtime?.stop()
    runtime = null
    if (fallbackEndpointDirectory) {
      await fs.rm(fallbackEndpointDirectory, { recursive: true, force: true })
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  async function pathsAndCredential() {
    const paths = resolveLocalSessionHostPaths({
      userDataRoot: temporaryRoot,
      temporaryRoot: '/tmp',
      platform: 'darwin',
    })
    await prepareLocalSessionHostPaths(paths)
    fallbackEndpointDirectory =
      paths.endpointDirectory === paths.stateRoot ? null : paths.endpointDirectory
    return { paths, credential: await ensureLocalUserCredential(paths.credentialPath) }
  }

  it('queues events after the synchronous snapshot cursor without duplicating their deltas', async () => {
    const { paths, credential } = await pathsAndCredential()
    let releaseAuthorization: (() => void) | undefined
    const authorizationGate = new Promise<void>((resolve) => {
      releaseAuthorization = resolve
    })
    runtime = await startLocalSessionHost({
      endpoint: paths.endpoint,
      databasePath: paths.databasePath,
      idleGracePeriodMs: 60_000,
      authenticate: createLocalSessionAuthenticator({ localUserCredential: credential }),
      dispatch: async () => ({ accepted: true }),
      snapshotActiveRuns: () => [
        {
          sessionId: SessionId('session-running'),
          model: SupportedModelId('provider/model'),
          mode: 'classic',
          startedAt: 1,
          messageId: 'message-running',
          parts: [{ type: 'text', text: 'before' }],
        },
      ],
      authorizeActiveRun: async () => {
        await authorizationGate
        return true
      },
    })
    const abortController = new AbortController()
    const snapshots: unknown[] = []
    const events: unknown[] = []
    const watching = watchLocalSessionEvents({
      paths,
      clientVersion: 'test',
      signal: abortController.signal,
      onSnapshot: (snapshot) => {
        snapshots.push(snapshot)
      },
      onEvent: (event) => {
        events.push(event)
        abortController.abort()
      },
    })
    for (let attempt = 0; attempt < 50 && runtime.eventHub.subscriberCount() === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    runtime.eventHub.publish({
      kind: 'session-transport',
      sessionId: 'session-running',
      event: {
        type: 'message_update',
        messageId: 'message-running',
        role: 'assistant',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' after' },
        timestamp: 2,
      },
    })
    releaseAuthorization?.()

    await expect(watching).resolves.toEqual({ status: 'closed' })
    expect(snapshots).toEqual([
      [expect.objectContaining({ parts: [{ type: 'text', text: 'before' }] })],
    ])
    expect(events).toHaveLength(1)
  })

  it('replays from a supplied cursor without replacing state with a later snapshot', async () => {
    const { paths, credential } = await pathsAndCredential()
    const snapshotActiveRuns = vi.fn(() => [])
    runtime = await startLocalSessionHost({
      endpoint: paths.endpoint,
      databasePath: paths.databasePath,
      idleGracePeriodMs: 60_000,
      authenticate: createLocalSessionAuthenticator({ localUserCredential: credential }),
      dispatch: async () => ({ accepted: true }),
      snapshotActiveRuns,
    })
    const after = runtime.eventHub.cursor()
    runtime.eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-target',
      stateRevision: 1,
      operation: 'message',
    })
    const abortController = new AbortController()
    const onSnapshot = vi.fn()
    const result = await watchLocalSessionEvents({
      paths,
      clientVersion: 'test',
      after,
      signal: abortController.signal,
      onSnapshot,
      onEvent: () => abortController.abort(),
    })

    expect(result).toEqual({ status: 'closed' })
    expect(onSnapshot).not.toHaveBeenCalled()
    expect(snapshotActiveRuns).not.toHaveBeenCalled()
  })
})
