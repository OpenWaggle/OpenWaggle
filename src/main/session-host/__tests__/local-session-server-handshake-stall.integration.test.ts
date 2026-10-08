import fs from 'node:fs/promises'
import type { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { encodeLocalSessionFrame } from '../local-session-framing'
import { type LocalSessionServerHandle, listenLocalSessionServer } from '../local-session-server'
import { connectLocalSessionTestClient, TestFrameReader } from './local-session-server-test-client'

const HANDSHAKE_TIMEOUT_MS = 50
const HOST_STALL_MS = 200
const ACCEPT_SETTLE_MS = 10

/** A synchronous Host stall: nothing else on this event loop runs until it returns. */
function blockEventLoop(milliseconds: number) {
  const until = performance.now() + milliseconds
  while (performance.now() < until) {
    // Busy wait, like a long synchronous SQLite statement or JSON serialization.
  }
}

function hello() {
  return encodeLocalSessionFrame({
    protocol: 'openwaggle-local-session',
    supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
    clientKind: 'gui',
    clientVersion: 'test',
  })
}

describe('Local Session handshake deadline under a Host event-loop stall', () => {
  let temporaryRoot = ''
  let handle: LocalSessionServerHandle | null = null
  let client: Socket | null = null
  let liveness: SessionHostLiveness | null = null

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-handshake-stall-'))
  })

  afterEach(async () => {
    client?.destroy()
    if (handle) await handle.close()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  async function listen(
    name: string,
    authenticate: () => Promise<{ readonly callerId: string }> = async () => ({
      callerId: 'gui:local-user',
    }),
  ) {
    const endpoint = path.join(temporaryRoot, name)
    liveness = new SessionHostLiveness({ idleGracePeriodMs: 60_000, requestShutdown: vi.fn() })
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub: new SessionHostEventHub({ hostInstanceId: 'host-current' }),
      liveness,
      authenticate,
      dispatch: async () => ({ accepted: true }),
      handshakeTimeoutMs: HANDSHAKE_TIMEOUT_MS,
    })
    return endpoint
  }

  it('accepts a hello that arrived in time when a stall delays its authentication', async () => {
    // The Host is busy with unrelated synchronous work while this hello is being handled, and
    // authentication resumes on a later turn of the event loop than the deadline timer.
    const endpoint = await listen('stalled.sock', async () => {
      blockEventLoop(HOST_STALL_MS)
      await new Promise((resolve) => setTimeout(resolve, 0))
      return { callerId: 'gui:local-user' }
    })
    client = await connectLocalSessionTestClient(endpoint)
    const reader = new TestFrameReader(client)

    client.write(hello())

    await expect(reader.next()).resolves.toMatchObject({
      accepted: true,
      revision: LOCAL_SESSION_CURRENT_REVISION,
    })
  })

  it('accepts a buffered hello when the Host stalls past the deadline before reading it', async () => {
    const endpoint = await listen('buffered.sock')
    client = await connectLocalSessionTestClient(endpoint)
    const reader = new TestFrameReader(client)
    // Let the Host accept the connection, which arms its handshake deadline.
    await new Promise((resolve) => setTimeout(resolve, ACCEPT_SETTLE_MS))

    // The hello reaches the socket buffer, then the Host stalls past its deadline in the check
    // phase. When the loop resumes, Node runs the expired deadline before it reads the socket.
    const socket = client
    setImmediate(() => {
      socket.write(hello())
      blockEventLoop(HOST_STALL_MS)
    })

    await expect(reader.next()).resolves.toMatchObject({
      accepted: true,
      revision: LOCAL_SESSION_CURRENT_REVISION,
    })
  })

  it('expires a received hello whose authentication never completes', async () => {
    const endpoint = await listen('hung.sock', () => new Promise<never>(() => {}))
    client = await connectLocalSessionTestClient(endpoint)
    const reader = new TestFrameReader(client)

    client.write(hello())

    await expect(reader.next()).resolves.toMatchObject({
      kind: 'error',
      code: 'handshake_timeout',
      retryable: true,
    })
  })

  it('does not admit a caller whose authentication finishes after the deadline expired', async () => {
    let finishAuthentication: (() => void) | undefined
    const authenticated = new Promise<void>((resolve) => {
      finishAuthentication = resolve
    })
    let authenticationReturned: (() => void) | undefined
    const returned = new Promise<void>((resolve) => {
      authenticationReturned = resolve
    })
    const endpoint = await listen('late-auth.sock', async () => {
      await authenticated
      setImmediate(() => authenticationReturned?.())
      return { callerId: 'gui:local-user' }
    })
    client = await connectLocalSessionTestClient(endpoint)
    const reader = new TestFrameReader(client)
    const frames: unknown[] = []
    const socket = client
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))

    client.write(hello())
    frames.push(await reader.next())
    // The Host ended the connection after the timeout frame and has already cleaned it up.
    await closed
    await new Promise((resolve) => setTimeout(resolve, ACCEPT_SETTLE_MS))
    finishAuthentication?.()
    await returned

    expect(frames).toEqual([
      {
        kind: 'error',
        code: 'handshake_timeout',
        message: 'Local Session handshake timed out.',
        retryable: true,
      },
    ])
    expect(liveness?.ownerCount('client')).toBe(0)
    expect(liveness?.hasAcceptedClient()).toBe(false)
  })

  it('still times out a client that never sends a hello, as a retryable failure', async () => {
    const endpoint = await listen('silent.sock')
    client = await connectLocalSessionTestClient(endpoint)
    const reader = new TestFrameReader(client)

    await expect(reader.next()).resolves.toEqual({
      kind: 'error',
      code: 'handshake_timeout',
      message: 'Local Session handshake timed out.',
      retryable: true,
    })
  })
})
