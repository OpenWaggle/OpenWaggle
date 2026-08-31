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

describe('Local Session authentication budget', () => {
  let temporaryRoot = ''
  let handle: LocalSessionServerHandle | null = null
  const clients: Socket[] = []

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-session-auth-'))
  })

  afterEach(async () => {
    for (const client of clients.splice(0)) client.destroy()
    if (handle) await handle.close()
    handle = null
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  async function attempt(endpoint: string, profile: string) {
    const socket = await connectLocalSessionTestClient(endpoint)
    clients.push(socket)
    const reader = new TestFrameReader(socket)
    socket.write(
      encodeLocalSessionFrame({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [2],
        clientKind: 'cli',
        clientVersion: 'authentication-throttle',
        profile,
        credential: 'credential',
      }),
    )
    return reader.next()
  }

  function dependencies(authenticate: () => Promise<{ callerId: string }>) {
    return {
      hostInstanceId: 'host-current',
      eventHub: new SessionHostEventHub({ hostInstanceId: 'host-current' }),
      liveness: new SessionHostLiveness({
        idleGracePeriodMs: 60_000,
        requestShutdown: vi.fn(),
      }),
      authenticate,
      dispatch: async () => ({ accepted: true }),
    }
  }

  it('throttles repeated profile failures and recovers after cooldown', async () => {
    const endpoint = path.join(temporaryRoot, 'profile.sock')
    const authenticate = vi
      .fn<() => Promise<{ callerId: string }>>()
      .mockRejectedValueOnce(new Error('Credential rejected.'))
      .mockResolvedValue({ callerId: 'profile:worker' })
    handle = await listenLocalSessionServer(endpoint, {
      ...dependencies(authenticate),
      maxFailedAuthenticationAttempts: 1,
      authenticationCooldownMs: 25,
    })

    await expect(attempt(endpoint, 'worker')).resolves.toMatchObject({
      kind: 'error',
      code: 'authentication_failed',
    })
    await expect(attempt(endpoint, 'worker')).resolves.toMatchObject({
      kind: 'error',
      code: 'authentication_failed',
    })
    expect(authenticate).toHaveBeenCalledOnce()
    await new Promise((resolve) => setTimeout(resolve, 30))
    await expect(attempt(endpoint, 'worker')).resolves.toMatchObject({
      accepted: true,
      revision: 2,
    })
    expect(authenticate).toHaveBeenCalledTimes(2)
  })

  it('globally throttles distinct-profile floods without evicting the budget', async () => {
    const endpoint = path.join(temporaryRoot, 'global.sock')
    const authenticate = vi
      .fn<() => Promise<{ callerId: string }>>()
      .mockRejectedValueOnce(new Error('Credential rejected.'))
      .mockRejectedValueOnce(new Error('Credential rejected.'))
      .mockResolvedValue({ callerId: 'profile:recovered' })
    handle = await listenLocalSessionServer(endpoint, {
      ...dependencies(authenticate),
      maxFailedAuthenticationAttempts: 10,
      maxFailedAuthenticationAttemptsGlobal: 2,
      authenticationCooldownMs: 25,
    })

    await expect(attempt(endpoint, 'attacker-one')).resolves.toMatchObject({
      code: 'authentication_failed',
    })
    await expect(attempt(endpoint, 'attacker-two')).resolves.toMatchObject({
      code: 'authentication_failed',
    })
    await expect(attempt(endpoint, 'worker')).resolves.toMatchObject({
      code: 'authentication_failed',
    })
    expect(authenticate).toHaveBeenCalledTimes(2)
    await new Promise((resolve) => setTimeout(resolve, 30))
    await expect(attempt(endpoint, 'worker')).resolves.toMatchObject({
      accepted: true,
      revision: 2,
    })
    expect(authenticate).toHaveBeenCalledTimes(3)
  })
})
