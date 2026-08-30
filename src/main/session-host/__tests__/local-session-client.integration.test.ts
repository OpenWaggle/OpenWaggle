import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLocalSessionAuthenticator } from '../local-session-authenticator'
import {
  executeLocalSessionCommand,
  LocalSessionHostUpgradePendingError,
  probeLocalSessionHost,
  resolveLocalSessionCommandTimeoutMs,
  watchLocalSessionEvents,
} from '../local-session-client'
import { type LocalSessionHostRuntime, startLocalSessionHost } from '../local-session-host-runtime'
import { prepareLocalSessionHostPaths, resolveLocalSessionHostPaths } from '../local-session-paths'
import { ensureLocalUserCredential } from '../local-user-credential'

describe('Local Session client', () => {
  let temporaryRoot = ''
  let runtime: LocalSessionHostRuntime | null = null
  let fallbackEndpointDirectory: string | null = null

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-local-client-'))
  })

  afterEach(async () => {
    await runtime?.stop()
    if (fallbackEndpointDirectory) {
      await fs.rm(fallbackEndpointDirectory, { recursive: true, force: true })
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('keeps long-poll transport timeouts beyond the requested Session wait', () => {
    expect(
      resolveLocalSessionCommandTimeoutMs(
        {
          contract: 'session-query-v2',
          request: {
            contractVersion: 2,
            requestId: 'request-wait',
            query: {
              operation: 'wait',
              targets: [{ sessionId: 'session-target', condition: 'idle' }],
              timeoutMs: 300_000,
            },
          },
        },
        1,
      ),
    ).toBe(305_000)
  })

  it('negotiates, authenticates, and sends one exact v2 command envelope', async () => {
    const paths = resolveLocalSessionHostPaths({
      userDataRoot: temporaryRoot,
      temporaryRoot: '/tmp',
      platform: 'darwin',
    })
    await prepareLocalSessionHostPaths(paths)
    fallbackEndpointDirectory =
      paths.endpointDirectory === paths.stateRoot ? null : paths.endpointDirectory
    const credential = await ensureLocalUserCredential(paths.credentialPath)
    const calls: unknown[] = []
    runtime = await startLocalSessionHost({
      endpoint: paths.endpoint,
      databasePath: paths.databasePath,
      idleGracePeriodMs: 60_000,
      authenticate: createLocalSessionAuthenticator({ localUserCredential: credential }),
      dispatch: async (input) => {
        calls.push(input)
        return {
          contract: 'session-control-v2',
          response: {
            contractVersion: 2,
            requestId: 'request-message',
            idempotencyKey: 'message-once',
            replayed: false,
            outcome: {
              operation: 'message',
              effect: 'rejected',
              sessionId: 'session-target',
              code: 'test-response',
            },
          },
        }
      },
    })

    await expect(
      probeLocalSessionHost({ paths, clientKind: 'gui', clientVersion: 'test' }),
    ).resolves.toMatchObject({ accepted: true, revision: 2 })
    await expect(
      executeLocalSessionCommand({
        paths,
        clientKind: 'gui',
        clientVersion: 'test',
        workingDirectory: '/project/worktree',
        payload: {
          contract: 'session-control-v2',
          request: {
            contractVersion: 2,
            requestId: 'request-message',
            idempotencyKey: 'message-once',
            command: {
              operation: 'message',
              sessionId: 'session-target',
              input: { text: 'Continue.', attachmentIds: [] },
            },
          },
        },
      }),
    ).resolves.toMatchObject({
      contract: 'session-control-v2',
      response: { outcome: { code: 'test-response' } },
    })
    expect(calls).toEqual([
      expect.objectContaining({
        negotiatedRevision: 2,
        caller: {
          callerId: 'gui:local-user',
          workingDirectory: '/project/worktree',
        },
      }),
    ])
  })

  it('subscribes from the current cursor and streams events until cancelled', async () => {
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
      authenticate: createLocalSessionAuthenticator({ localUserCredential: credential }),
      dispatch: async () => ({ accepted: true }),
      snapshotActiveRuns: () => [
        {
          sessionId: SessionId('session-already-running'),
          model: SupportedModelId('provider/model'),
          mode: 'classic',
          startedAt: 1,
          parts: [{ type: 'text', text: 'already streamed' }],
        },
      ],
    })
    const abortController = new AbortController()
    const events: unknown[] = []
    const snapshots: unknown[] = []
    const watching = watchLocalSessionEvents({
      paths,
      clientVersion: 'test',
      signal: abortController.signal,
      onSnapshot: (activeRuns) => {
        snapshots.push(activeRuns)
      },
      onEvent: (event) => {
        events.push(event)
        if (events.length === 4) abortController.abort()
      },
    })
    for (let attempt = 0; attempt < 50 && runtime.eventHub.subscriberCount() === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    runtime.eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-target',
      stateRevision: 1,
      operation: 'message',
    })
    runtime.eventHub.publish({
      kind: 'session-waggle-transport',
      sessionId: 'session-target',
      event: { type: 'agent_start', runId: 'waggle-1', timestamp: 2 },
      meta: {
        agentIndex: 0,
        agentLabel: 'Worker',
        agentColor: 'blue',
        agentModel: SupportedModelId('provider/model'),
        turnNumber: 1,
        collaborationMode: 'sequential',
      },
    })
    runtime.eventHub.publish({
      kind: 'session-waggle-turn',
      sessionId: 'session-target',
      event: { type: 'collaboration-complete', reason: 'done', totalTurns: 1 },
    })
    runtime.eventHub.publish({
      kind: 'session-export-changed',
      sessionId: 'session-target',
      exportOperationId: 'export-1',
      status: 'running',
      progress: { recordsWritten: 1, resourcesWritten: 0, bytesWritten: 10 },
    })

    await expect(watching).resolves.toEqual({ status: 'closed' })
    expect(events).toHaveLength(4)
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            kind: 'session-state-changed',
            sessionId: 'session-target',
            stateRevision: 1,
          }),
        }),
        expect.objectContaining({
          payload: expect.objectContaining({ kind: 'session-waggle-transport' }),
        }),
        expect.objectContaining({
          payload: expect.objectContaining({ kind: 'session-waggle-turn' }),
        }),
        expect.objectContaining({
          payload: expect.objectContaining({ kind: 'session-export-changed' }),
        }),
      ]),
    )
    expect(snapshots).toEqual([
      [
        {
          sessionId: SessionId('session-already-running'),
          model: SupportedModelId('provider/model'),
          mode: 'classic',
          startedAt: 1,
          parts: [{ type: 'text', text: 'already streamed' }],
        },
      ],
    ])
  })

  it('surfaces authenticated upgrade blockers without starting a second Host', async () => {
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
      authenticate: createLocalSessionAuthenticator({ localUserCredential: credential }),
      describeUpgradeBlockers: async () => ({
        blockingRuns: [{ sessionId: 'session-live', runId: 'run-live' }],
        blockingOperations: [],
      }),
      dispatch: async () => ({ accepted: true }),
    })
    const releaseRun = runtime.liveness.acquire('run')

    await expect(
      probeLocalSessionHost({
        paths,
        clientVersion: 'future',
        supportedRevisions: [3],
      }),
    ).rejects.toMatchObject({
      name: LocalSessionHostUpgradePendingError.name,
      code: 'host_upgrade_pending',
      blockingRuns: [{ sessionId: 'session-live', runId: 'run-live' }],
    })
    expect(runtime.liveness.isDraining()).toBe(true)
    expect(runtime.liveness.ownerCount('run')).toBe(1)

    releaseRun()
    await runtime.waitUntilStopped()
  })
})
