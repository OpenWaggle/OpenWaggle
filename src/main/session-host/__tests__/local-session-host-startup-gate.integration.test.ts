import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalSessionHostRuntime } from '../local-session-host-runtime'
import { startLocalSessionHost } from '../local-session-host-runtime'
import { acquireSessionHostOwnership } from '../session-host-ownership'

const CONNECTION_PROBE_TIMEOUT_MS = 100

function endpointFor(name: string) {
  const identity = randomUUID()
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\openwaggle-${name}-${identity}`
    : path.join('/tmp', `ow-${name}-${identity}.sock`)
}

function canConnect(endpoint: string) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection(endpoint)
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, CONNECTION_PROBE_TIMEOUT_MS)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

describe('Local Session Host startup gate', () => {
  let temporaryRoot = ''
  let runtime: LocalSessionHostRuntime | null = null

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-host-startup-gate-'))
  })

  afterEach(async () => {
    await runtime?.stop()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('does not listen or admit clients while Host-owned services are still starting', async () => {
    const endpoint = endpointFor('pending-services')
    let markStarting: (() => void) | undefined
    let finishStarting: (() => void) | undefined
    const starting = new Promise<void>((resolve) => {
      markStarting = resolve
    })
    const servicesReady = new Promise<void>((resolve) => {
      finishStarting = resolve
    })
    const dispatch = vi.fn(async () => ({ accepted: true }))

    const hostStarting = startLocalSessionHost({
      endpoint,
      databasePath: path.join(temporaryRoot, 'pending-services.sqlite'),
      idleGracePeriodMs: 60_000,
      startOwnedServices: async () => {
        markStarting?.()
        await servicesReady
      },
      stopOwnedServices: async () => undefined,
      authenticate: async () => ({ callerId: 'local-user' }),
      dispatch,
    })

    await starting
    await expect(canConnect(endpoint)).resolves.toBe(false)
    expect(dispatch).not.toHaveBeenCalled()

    finishStarting?.()
    runtime = await hostStarting
    await expect(canConnect(endpoint)).resolves.toBe(true)
  })

  it('never publishes an endpoint and releases ownership when owned-service startup fails', async () => {
    const endpoint = endpointFor('failed-services')
    const databasePath = path.join(temporaryRoot, 'failed-services.sqlite')
    const startupFailure = new Error('owned services failed')
    const stopOwnedServices = vi.fn(async () => undefined)

    await expect(
      startLocalSessionHost({
        endpoint,
        databasePath,
        idleGracePeriodMs: 60_000,
        startOwnedServices: async () => {
          throw startupFailure
        },
        stopOwnedServices,
        authenticate: async () => ({ callerId: 'local-user' }),
        dispatch: async () => ({ accepted: true }),
      }),
    ).rejects.toBe(startupFailure)

    expect(stopOwnedServices).toHaveBeenCalledOnce()
    await expect(canConnect(endpoint)).resolves.toBe(false)
    const successor = await acquireSessionHostOwnership(databasePath)
    await successor.release()
  })
})
