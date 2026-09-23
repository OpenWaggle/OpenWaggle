import fs from 'node:fs/promises'
import type { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { SupportedModelId } from '@shared/types/brand'
import { LOCAL_SESSION_UPDATE_REVISION } from '@shared/types/local-session-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { encodeLocalSessionFrame } from '../local-session-framing'
import { type LocalSessionServerHandle, listenLocalSessionServer } from '../local-session-server'
import { connectLocalSessionTestClient, TestFrameReader } from './local-session-server-test-client'

describe('Local Session worktree event revision', () => {
  let temporaryRoot = ''
  let handle: LocalSessionServerHandle | null = null
  let client: Socket | null = null

  afterEach(async () => {
    client?.destroy()
    if (handle) await handle.close()
    if (temporaryRoot) await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('does not send revision-fifteen worktree events to a revision-fourteen client', async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-host-'))
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    handle = await listenLocalSessionServer(path.join(temporaryRoot, 'host.sock'), {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      authenticate: async () => ({ callerId: 'local-user:test' }),
      authorizeEvent: async () => true,
      dispatch: async () => ({ accepted: true }),
    })
    client = await connectLocalSessionTestClient(handle.endpoint)
    const reader = new TestFrameReader(client)
    client.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [LOCAL_SESSION_UPDATE_REVISION],
        clientKind: 'cli',
        clientVersion: 'previous',
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({
      accepted: true,
      revision: LOCAL_SESSION_UPDATE_REVISION,
    })
    client.write(encodeLocalSessionFrame({ kind: 'subscribe', requestId: 'subscribe' }))
    await expect(reader.next()).resolves.toMatchObject({ kind: 'subscribed' })

    eventHub.publish({
      kind: 'session-worktree-launch',
      sessionId: 'session-1',
      model: SupportedModelId('provider/model'),
      mode: 'classic',
      event: {
        type: 'progress',
        progress: { stage: 'checking-out-files', details: ['Checking out files'] },
      },
    })
    const visible = eventHub.publish({
      kind: 'session-state-changed',
      sessionId: 'session-1',
      stateRevision: 1,
      operation: 'message',
    })

    await expect(reader.next()).resolves.toMatchObject({ kind: 'cursor-advanced' })
    await expect(reader.next()).resolves.toMatchObject({
      kind: 'event',
      event: { ...visible, cursor: expect.any(Object) },
    })
  })
})
