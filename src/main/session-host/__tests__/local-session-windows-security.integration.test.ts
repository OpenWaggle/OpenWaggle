import fs from 'node:fs/promises'
import net, { type Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { encodeLocalSessionFrame } from '../local-session-framing'
import { type LocalSessionServerHandle, listenLocalSessionServer } from '../local-session-server'
import { secureWindowsUserOnly } from '../windows-user-only-security'
import { connectLocalSessionTestClient, TestFrameReader } from './local-session-server-test-client'

const itWindows = process.platform === 'win32' ? it : it.skip

function serverDependencies() {
  return {
    hostInstanceId: 'windows-user-only-host',
    eventHub: new SessionHostEventHub({ hostInstanceId: 'windows-user-only-host' }),
    liveness: new SessionHostLiveness({
      idleGracePeriodMs: 60_000,
      requestShutdown: vi.fn(),
    }),
    authenticate: async () => ({ callerId: 'local-user' }),
    dispatch: async () => ({ accepted: true }),
  }
}

function connect(endpoint: string) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = net.createConnection(endpoint)
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}

describe('Windows Local Session user-only admission', () => {
  let temporaryRoot = ''
  let handle: LocalSessionServerHandle | null = null
  const sockets: Socket[] = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-windows-pipe-'))
  })

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.destroy()
    if (handle) await handle.close()
    handle = null
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('fails closed and releases the endpoint when security verification fails', async () => {
    const endpoint = path.join(temporaryRoot, 'security-failure.sock')
    await expect(
      listenLocalSessionServer(endpoint, {
        ...serverDependencies(),
        secureEndpoint: async () => {
          throw new Error('DACL verification failed.')
        },
      }),
    ).rejects.toThrow('DACL verification failed.')

    await expect(connect(endpoint)).rejects.toBeDefined()
  })

  itWindows('destroys connections accepted before the user-only DACL is verified', async () => {
    const endpoint = `\\\\.\\pipe\\openwaggle-security-gate-${crypto.randomUUID()}`
    let releaseSecurity: (() => void) | undefined
    const securityPending = new Promise<void>((resolve) => {
      releaseSecurity = resolve
    })
    const starting = listenLocalSessionServer(endpoint, {
      ...serverDependencies(),
      secureEndpoint: async () => securityPending,
    })
    const quarantined = await connect(endpoint)
    sockets.push(quarantined)
    await expect(
      new Promise<void>((resolve) => quarantined.once('close', resolve)),
    ).resolves.toBeUndefined()
    releaseSecurity?.()
    handle = await starting

    const admitted = await connectLocalSessionTestClient(endpoint)
    sockets.push(admitted)
    const reader = new TestFrameReader(admitted)
    admitted.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [7],
        clientKind: 'cli',
        clientVersion: 'windows-user-only-test',
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({ accepted: true, revision: 7 })
  })

  itWindows('starts only after PowerShell verifies the protected user-SID-only DACL', async () => {
    const endpoint = `\\\\.\\pipe\\openwaggle-owner-dacl-${crypto.randomUUID()}`
    handle = await listenLocalSessionServer(endpoint, serverDependencies())
    const verified = await secureWindowsUserOnly([{ kind: 'pipe', path: endpoint }])

    expect(verified.userSid).not.toBe('S-1-5-32-544')
    expect(verified.userSid).not.toBe('S-1-1-0')
    expect(verified.userSid).not.toBe('S-1-5-7')

    const client = await connectLocalSessionTestClient(endpoint)
    sockets.push(client)
    const reader = new TestFrameReader(client)
    client.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [7],
        clientKind: 'cli',
        clientVersion: 'windows-user-dacl-test',
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({ accepted: true, revision: 7 })
  })
})
