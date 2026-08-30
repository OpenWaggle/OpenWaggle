import fs from 'node:fs/promises'
import type { Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { encodeLocalSessionFrame } from '../local-session-framing'
import { type LocalSessionServerHandle, listenLocalSessionServer } from '../local-session-server'
import { connectLocalSessionTestClient, TestFrameReader } from './local-session-server-test-client'

describe('Local Session server concurrency', () => {
  let temporaryRoot = ''
  let handle: LocalSessionServerHandle | null = null
  let client: Socket | null = null
  const additionalClients: Socket[] = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-host-'))
  })

  afterEach(async () => {
    client?.destroy()
    for (const additionalClient of additionalClients.splice(0)) additionalClient.destroy()
    if (handle) await handle.close()
    handle = null
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  async function connect(endpoint: string) {
    const socket = await connectLocalSessionTestClient(endpoint)
    client = socket
    const reader = new TestFrameReader(socket)
    socket.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [2],
        clientKind: 'cli',
        clientVersion: 'test',
      }),
    )
    await reader.next()
    return { reader, socket }
  }

  it('aborts an in-flight command when its client disconnects', async () => {
    const endpoint = path.join(temporaryRoot, 'host-abort.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    let observedSignal: AbortSignal | undefined
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      authenticate: async () => ({ callerId: 'local-user' }),
      dispatch: ({ signal }) =>
        new Promise((_resolve, reject) => {
          observedSignal = signal
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
    })
    const { reader, socket } = await connect(endpoint)
    socket.write(
      encodeLocalSessionFrame({
        kind: 'command',
        requestId: 'wait',
        payload: { operation: 'wait' },
      }),
    )
    await vi.waitFor(() => expect(observedSignal).toBeDefined())
    socket.destroy()
    await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true))
    void reader
  })

  it('bounds subscriptions per connection before allocating another event queue', async () => {
    const endpoint = path.join(temporaryRoot, 'subscriptions.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      maxSubscriptionsPerConnection: 1,
      authenticate: async () => ({ callerId: 'local-user' }),
      dispatch: async () => ({ accepted: true }),
    })
    const { reader, socket } = await connect(endpoint)
    socket.write(
      encodeLocalSessionFrame({ kind: 'subscribe', requestId: 'first', after: eventHub.cursor() }),
    )
    await expect(reader.next()).resolves.toMatchObject({ kind: 'subscribed', requestId: 'first' })
    socket.write(
      encodeLocalSessionFrame({ kind: 'subscribe', requestId: 'second', after: eventHub.cursor() }),
    )
    await expect(reader.next()).resolves.toMatchObject({
      kind: 'error',
      requestId: 'second',
      code: 'subscription_limit_exceeded',
    })
    expect(eventHub.subscriberCount()).toBe(1)
  })

  it('applies inbound backpressure while a previous frame is still executing', async () => {
    const endpoint = path.join(temporaryRoot, 'backpressure.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    let releaseFirst: (() => void) | undefined
    const dispatch = vi.fn(
      () =>
        new Promise<{ accepted: true }>((resolve) => {
          releaseFirst = () => resolve({ accepted: true })
        }),
    )
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      authenticate: async () => ({ callerId: 'local-user' }),
      dispatch,
    })
    const { reader, socket } = await connect(endpoint)
    socket.write(
      Buffer.concat([
        encodeLocalSessionFrame({ kind: 'command', requestId: 'first', payload: {} }),
        encodeLocalSessionFrame({ kind: 'command', requestId: 'second', payload: {} }),
      ]),
    )
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    releaseFirst?.()
    await expect(reader.next()).resolves.toMatchObject({ kind: 'response', requestId: 'first' })
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2))
    releaseFirst?.()
    await expect(reader.next()).resolves.toMatchObject({ kind: 'response', requestId: 'second' })
  })

  it('enforces and releases one aggregate pending-byte budget before authentication', async () => {
    const endpoint = path.join(temporaryRoot, 'inbound-budget.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      maxPendingInboundBytesGlobal: 256,
      authenticate: async () => ({ callerId: 'local-user' }),
      dispatch: async () => ({ accepted: true }),
    })
    const first = await connectLocalSessionTestClient(endpoint)
    const second = await connectLocalSessionTestClient(endpoint)
    additionalClients.push(first, second)
    const secondReader = new TestFrameReader(second)
    const incomplete = Buffer.alloc(164)
    incomplete.writeUInt32BE(200)
    first.write(incomplete)
    await new Promise((resolve) => setTimeout(resolve, 10))
    second.write(incomplete)

    await expect(secondReader.next()).resolves.toMatchObject({
      kind: 'error',
      code: 'inbound_backpressure_exceeded',
    })
    const firstClosed = new Promise<void>((resolve) => first.once('close', resolve))
    first.destroy()
    await firstClosed

    const third = await connectLocalSessionTestClient(endpoint)
    additionalClients.push(third)
    const thirdReader = new TestFrameReader(third)
    third.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [2],
        clientKind: 'cli',
        clientVersion: 'budget-released',
      }),
    )
    await expect(thirdReader.next()).resolves.toMatchObject({ accepted: true, revision: 2 })
  })

  it('bounds authentication work across all connections', async () => {
    const endpoint = path.join(temporaryRoot, 'a.sock')
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-current' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    })
    let active = 0
    let peak = 0
    const releases: Array<() => void> = []
    const authenticate = vi.fn(
      () =>
        new Promise<{ callerId: string }>((resolve) => {
          active += 1
          peak = Math.max(peak, active)
          releases.push(() => {
            active -= 1
            resolve({ callerId: 'local-user' })
          })
        }),
    )
    handle = await listenLocalSessionServer(endpoint, {
      hostInstanceId: 'host-current',
      eventHub,
      liveness,
      maxConcurrentAuthentications: 1,
      authenticate,
      dispatch: async () => ({ accepted: true }),
    })
    const clients = await Promise.all(
      Array.from({ length: 3 }, () => connectLocalSessionTestClient(endpoint)),
    )
    additionalClients.push(...clients)
    const readers = clients.map((socket) => new TestFrameReader(socket))
    for (const socket of clients) {
      socket.write(
        encodeLocalSessionFrame({
          protocol: 'openwaggle-local-session',
          supportedRevisions: [2],
          clientKind: 'cli',
          clientVersion: 'authentication-budget',
          profile: 'worker',
          credential: 'invalid-for-test',
        }),
      )
    }

    await vi.waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1))
    for (let expected = 2; expected <= clients.length; expected += 1) {
      releases.shift()?.()
      await vi.waitFor(() => expect(authenticate).toHaveBeenCalledTimes(expected))
    }
    releases.shift()?.()
    await Promise.all(
      readers.map((reader) =>
        expect(reader.next()).resolves.toMatchObject({ accepted: true, revision: 2 }),
      ),
    )
    expect(peak).toBe(1)
  })
})
