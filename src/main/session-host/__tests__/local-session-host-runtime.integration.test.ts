import fs from 'node:fs/promises'
import net, { type Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { encodeLocalSessionFrame, LocalSessionFrameDecoder } from '../local-session-framing'
import { LocalSessionHostRuntime, startLocalSessionHost } from '../local-session-host-runtime'
import { acquireSessionHostOwnership } from '../session-host-ownership'

function connect(endpoint: string) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = net.createConnection(endpoint)
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}

function readFrame(socket: Socket) {
  const decoder = new LocalSessionFrameDecoder()
  return new Promise<unknown>((resolve) => {
    socket.on('data', (chunk) => {
      const value = decoder.push(chunk)[0]
      if (value !== undefined) resolve(value)
    })
  })
}

describe('Local Session Host runtime', () => {
  let temporaryRoot = ''
  let runtime: LocalSessionHostRuntime | null = null
  let client: Socket | null = null

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-host-runtime-'))
  })

  afterEach(async () => {
    client?.destroy()
    if (runtime) await runtime.stop()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('shuts down after the idle grace period when no client ever connects', async () => {
    const endpoint = path.join(temporaryRoot, 'idle-host.sock')
    runtime = await startLocalSessionHost({
      endpoint,
      databasePath: path.join(temporaryRoot, 'idle-session-host.sqlite'),
      idleGracePeriodMs: 0,
      startupGracePeriodMs: 0,
      authenticate: async () => ({ callerId: 'local-user' }),
      dispatch: async () => ({ accepted: true }),
    })

    await expect(
      Promise.race([
        runtime.waitUntilStopped(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('idle Session Host did not stop')), 250),
        ),
      ]),
    ).resolves.toBeUndefined()
    await expect(fs.access(endpoint)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('applies a durable idle-grace update while the detached Host is running', async () => {
    const endpoint = path.join(temporaryRoot, 'live-settings-host.sock')
    let durableIdleGracePeriodMs = 60_000
    runtime = await startLocalSessionHost({
      endpoint,
      databasePath: path.join(temporaryRoot, 'live-settings-host.sqlite'),
      idleGracePeriodMs: durableIdleGracePeriodMs,
      startupGracePeriodMs: 60_000,
      settingsRefreshIntervalMs: 5,
      readIdleGracePeriod: async () => durableIdleGracePeriodMs,
      authenticate: async () => ({ callerId: 'local-user' }),
      dispatch: async () => ({ accepted: true }),
    })

    durableIdleGracePeriodMs = 0
    await expect(
      Promise.race([
        runtime.waitUntilStopped(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('live idle grace update was not applied')), 250),
        ),
      ]),
    ).resolves.toBeUndefined()
  })

  it('owns endpoint and store together, then shuts down after the final client grace period', async () => {
    const endpoint = path.join(temporaryRoot, 'host.sock')
    const databasePath = path.join(temporaryRoot, 'session-host.sqlite')
    const startupOrder: string[] = []
    runtime = await startLocalSessionHost({
      endpoint,
      databasePath,
      idleGracePeriodMs: 100,
      recover: async () => {
        startupOrder.push('recovered')
      },
      authenticate: async () => {
        startupOrder.push('authenticated')
        return { callerId: 'local-user' }
      },
      dispatch: async () => ({ accepted: true }),
    })
    client = await connect(endpoint)
    const negotiated = readFrame(client)
    client.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [2],
        clientKind: 'gui',
        clientVersion: 'test',
      }),
    )
    await expect(negotiated).resolves.toMatchObject({ accepted: true, revision: 2 })
    expect(startupOrder).toEqual(['recovered', 'authenticated'])
    expect(runtime.liveness.ownerCount('client')).toBe(1)

    client.destroy()
    await expect(
      Promise.race([
        runtime.waitUntilStopped(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('client handoff grace did not expire')), 2_000),
        ),
      ]),
    ).resolves.toBeUndefined()
    await expect(fs.access(endpoint)).rejects.toMatchObject({ code: 'ENOENT' })

    await expect(
      startLocalSessionHost({
        endpoint,
        databasePath,
        idleGracePeriodMs: 0,
        authenticate: async () => ({ callerId: 'local-user' }),
        dispatch: async () => ({ accepted: true }),
      }).then((next) => next.stop()),
    ).resolves.toBeUndefined()
  })

  it('removes the old endpoint before releasing singleton ownership', async () => {
    const order: string[] = []
    const eventHub = new SessionHostEventHub({ hostInstanceId: 'host-order' })
    const liveness = new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: () => undefined,
    })
    const server = net.createServer()
    const orderedRuntime = new LocalSessionHostRuntime(
      eventHub,
      liveness,
      {
        endpoint: path.join(temporaryRoot, 'unused.sock'),
        server,
        close: async () => {
          order.push('close')
        },
        removeEndpoint: async () => {
          order.push('remove-endpoint')
        },
      },
      {
        targetPath: path.join(temporaryRoot, 'unused.sqlite'),
        release: async () => {
          order.push('release-ownership')
        },
      },
      () => order.push('release-events'),
      () => undefined,
      async () => {
        order.push('stop-owned-services')
      },
    )

    await orderedRuntime.stop()

    expect(order).toEqual([
      'close',
      'stop-owned-services',
      'release-events',
      'remove-endpoint',
      'release-ownership',
    ])
  })

  it('keeps ownership fenced until Host-owned services have stopped', async () => {
    const databasePath = path.join(temporaryRoot, 'ordered-session-host.sqlite')
    let finishServices: (() => void) | undefined
    let markServicesStopping: (() => void) | undefined
    const servicesStopping = new Promise<void>((resolve) => {
      markServicesStopping = resolve
    })
    const servicesStopped = new Promise<void>((resolve) => {
      finishServices = resolve
    })
    runtime = await startLocalSessionHost({
      endpoint: path.join(temporaryRoot, 'ordered-host.sock'),
      databasePath,
      idleGracePeriodMs: 60_000,
      stopOwnedServices: async () => {
        markServicesStopping?.()
        await servicesStopped
      },
      authenticate: async () => ({ callerId: 'local-user' }),
      dispatch: async () => ({ accepted: true }),
    })

    const stopping = runtime.stop()
    await servicesStopping
    let successorAcquired = false
    const successor = acquireSessionHostOwnership(databasePath).then((ownership) => {
      successorAcquired = true
      return ownership
    })
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(successorAcquired).toBe(false)

    finishServices?.()
    await stopping
    const successorOwnership = await successor
    expect(successorAcquired).toBe(true)
    await successorOwnership.release()
  })
})
