import {
  LOCAL_SESSION_CAPABILITIES,
  LOCAL_SESSION_CURRENT_REVISION,
  LOCAL_SESSION_PROTOCOL_NAME,
} from '@shared/types/local-session-protocol'
import { describe, expect, it, vi } from 'vitest'
import type { LocalSessionHostLauncherDependencies } from '../local-session-host-launcher'
import { HOST_FAST_POLL_INTERVAL_MS } from '../local-session-host-polling'
import { waitForPrelaunchedLocalSessionHost } from '../local-session-host-prelaunch-wait'

const paths = {
  stateRoot: '/state',
  legacyDatabasePath: '/state/legacy.sqlite',
  databasePath: '/state/host.sqlite',
  recoveryDatabasePath: '/state/recovery.sqlite',
  credentialPath: '/state/credential',
  endpoint: '/state/host.sock',
  endpointDirectory: '/state',
  endpointCapabilityPath: null,
}

const accepted = {
  accepted: true as const,
  protocol: LOCAL_SESSION_PROTOCOL_NAME,
  revision: LOCAL_SESSION_CURRENT_REVISION,
  hostInstanceId: 'host-prelaunched',
  capabilities: LOCAL_SESSION_CAPABILITIES,
}

function dependencies(input: {
  readonly canConnect: LocalSessionHostLauncherDependencies['canConnect']
  readonly probe?: LocalSessionHostLauncherDependencies['probe']
}) {
  let now = 0
  return {
    canConnect: input.canConnect,
    probe: input.probe ?? vi.fn(async () => accepted),
    tryAcquireOwnership: vi.fn(async () => null),
    launch: vi.fn(),
    now: () => now,
    refreshPaths: vi.fn(async (candidate) => candidate),
    wait: vi.fn(async (milliseconds: number) => {
      now += milliseconds
    }),
  } satisfies LocalSessionHostLauncherDependencies
}

const client = { paths, clientKind: 'gui' as const, clientVersion: 'current' }

describe('waitForPrelaunchedLocalSessionHost', () => {
  it('waits for the Host the boot shim launched to answer, polling quickly, and launches none', async () => {
    const launcher = dependencies({ canConnect: vi.fn(async () => launcher.now() >= 300) })

    await expect(
      waitForPrelaunchedLocalSessionHost(
        { ...client, prelaunch: { hasEnded: () => false } },
        launcher,
      ),
    ).resolves.toBe(true)

    expect(launcher.launch).not.toHaveBeenCalled()
    expect(launcher.tryAcquireOwnership).not.toHaveBeenCalled()
    expect(launcher.probe).toHaveBeenCalledOnce()
    expect(
      launcher.wait.mock.calls.every(
        ([milliseconds]) => milliseconds === HOST_FAST_POLL_INTERVAL_MS,
      ),
    ).toBe(true)
  })

  it('keeps waiting while a listening Host does not accept the client yet', async () => {
    const probe = vi
      .fn<LocalSessionHostLauncherDependencies['probe']>()
      .mockRejectedValueOnce(new Error('still opening'))
      .mockResolvedValue(accepted)
    const launcher = dependencies({ canConnect: vi.fn(async () => true), probe })

    await expect(
      waitForPrelaunchedLocalSessionHost(
        { ...client, prelaunch: { hasEnded: () => false } },
        launcher,
      ),
    ).resolves.toBe(true)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('gives up once that process ended, so the caller starts a Host the usual way', async () => {
    let ended = false
    const canConnect = vi.fn(async () => {
      ended = true
      return false
    })
    const launcher = dependencies({ canConnect })

    await expect(
      waitForPrelaunchedLocalSessionHost(
        { ...client, prelaunch: { hasEnded: () => ended } },
        launcher,
      ),
    ).resolves.toBe(false)
    expect(canConnect).toHaveBeenCalledOnce()
  })

  it('stops waiting when the start is aborted', async () => {
    const controller = new AbortController()
    const launcher = dependencies({
      canConnect: vi.fn(async () => {
        controller.abort(new Error('retried'))
        return false
      }),
    })

    await expect(
      waitForPrelaunchedLocalSessionHost(
        { ...client, signal: controller.signal, prelaunch: { hasEnded: () => false } },
        launcher,
      ),
    ).rejects.toThrow('retried')
  })
})
