import fs from 'node:fs/promises'
import net, { type Socket } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { LOCAL_SESSION_CURRENT_REVISION } from '@shared/types/local-session-protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionHostEventHub } from '../../application/session-host-event-hub'
import { SessionHostLiveness } from '../../application/session-host-liveness'
import { secureLocalSessionEndpoint } from '../local-session-endpoint'
import { encodeLocalSessionFrame } from '../local-session-framing'
import { type LocalSessionServerHandle, listenLocalSessionServer } from '../local-session-server'
import { connectLocalSessionTestClient, TestFrameReader } from './local-session-server-test-client'
import { verifyWindowsPipeInstances } from './windows-pipe-readback-probe'
import { withWindowsCompileDiagnostics } from './windows-security-compile-diagnostics'

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
    const endpoint =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\openwaggle-security-failure-${crypto.randomUUID()}`
        : path.join(temporaryRoot, 'security-failure.sock')
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
    const securityEntered = Promise.withResolvers<void>()
    const securityPending = Promise.withResolvers<void>()
    const starting = listenLocalSessionServer(endpoint, {
      ...serverDependencies(),
      secureEndpoint: async () => {
        securityEntered.resolve()
        await securityPending.promise
      },
    })
    await securityEntered.promise
    try {
      const quarantined = await connect(endpoint)
      sockets.push(quarantined)
      await expect(
        new Promise<void>((resolve) => quarantined.once('close', () => resolve())),
      ).resolves.toBeUndefined()
      expect(quarantined.destroyed).toBe(true)
    } finally {
      securityPending.resolve()
      handle = await starting
    }

    const admitted = await connectLocalSessionTestClient(endpoint)
    sockets.push(admitted)
    const reader = new TestFrameReader(admitted)
    admitted.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
        clientKind: 'cli',
        clientVersion: 'windows-user-only-test',
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({
      accepted: true,
      revision: LOCAL_SESSION_CURRENT_REVISION,
    })
  })

  itWindows('starts only after PowerShell verifies the protected user-SID-only DACL', async () => {
    const endpoint = `\\\\.\\pipe\\openwaggle-owner-dacl-${crypto.randomUUID()}`
    const secureEndpoint = vi.fn(secureLocalSessionEndpoint)
    handle = await withWindowsCompileDiagnostics(() =>
      listenLocalSessionServer(endpoint, { ...serverDependencies(), secureEndpoint }),
    )
    const verifiedSid = await verifyWindowsPipeInstances(endpoint)

    expect(verifiedSid).toMatch(/^S-1-(?:\d+-)+\d+$/)
    expect(verifiedSid).not.toBe('S-1-5-32-544')
    expect(verifiedSid).not.toBe('S-1-1-0')
    expect(verifiedSid).not.toBe('S-1-5-7')
    expect(secureEndpoint).toHaveBeenCalledTimes(1)

    const client = await connectLocalSessionTestClient(endpoint)
    sockets.push(client)
    const reader = new TestFrameReader(client)
    client.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [LOCAL_SESSION_CURRENT_REVISION],
        clientKind: 'cli',
        clientVersion: 'windows-user-dacl-test',
      }),
    )
    await expect(reader.next()).resolves.toMatchObject({
      accepted: true,
      revision: LOCAL_SESSION_CURRENT_REVISION,
    })
  })
})
