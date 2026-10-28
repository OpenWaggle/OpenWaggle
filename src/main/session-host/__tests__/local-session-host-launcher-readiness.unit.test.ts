import {
  LOCAL_SESSION_CAPABILITIES,
  LOCAL_SESSION_CURRENT_REVISION,
  LOCAL_SESSION_PROTOCOL_NAME,
} from '@shared/types/local-session-protocol'
import { describe, expect, it, vi } from 'vitest'
import { LocalSessionHostUpgradePendingError } from '../local-session-client-connection'
import {
  ensureLocalSessionHost,
  type LocalSessionHostLauncherDependencies,
  sessionHostChildEnvironment,
} from '../local-session-host-launcher'
import {
  HOST_FAST_POLL_INTERVAL_MS,
  HOST_POLL_INTERVAL_MS,
  hostPollInterval,
} from '../local-session-host-polling'

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
  hostInstanceId: 'host-current',
  capabilities: LOCAL_SESSION_CAPABILITIES,
}

function dependencies(input?: {
  readonly canConnect?: LocalSessionHostLauncherDependencies['canConnect']
  readonly probe?: LocalSessionHostLauncherDependencies['probe']
  readonly refreshPaths?: LocalSessionHostLauncherDependencies['refreshPaths']
  readonly tryAcquireOwnership?: LocalSessionHostLauncherDependencies['tryAcquireOwnership']
}) {
  let now = 0
  return {
    canConnect: input?.canConnect ?? vi.fn(async () => true),
    probe: input?.probe ?? vi.fn(async () => accepted),
    tryAcquireOwnership:
      input?.tryAcquireOwnership ??
      vi.fn(async () => ({
        targetPath: paths.databasePath,
        release: vi.fn(async () => undefined),
      })),
    launch: vi.fn(),
    now: () => now,
    refreshPaths: input?.refreshPaths ?? vi.fn(async (candidate) => candidate),
    wait: vi.fn(async (milliseconds: number) => {
      now += milliseconds
    }),
  } satisfies LocalSessionHostLauncherDependencies
}

const client = { paths, clientKind: 'cli' as const, clientVersion: 'current' }

describe('Local Session Host launcher readiness', () => {
  it('looks for a launched Host every 10 ms for the first second, then every 50 ms (A-F14)', async () => {
    let probes = 0
    const canConnect = vi.fn(async () => {
      probes += 1
      // The first call is the authority check before launch; the Host listens 1.2 s later.
      return probes > 1 && launcher.now() >= 1_200
    })
    const launcher = dependencies({ canConnect })

    await expect(ensureLocalSessionHost(client, launcher)).resolves.toEqual(accepted)

    const intervals = launcher.wait.mock.calls.map(([milliseconds]) => milliseconds)
    expect(intervals.slice(0, 100).every((ms) => ms === HOST_FAST_POLL_INTERVAL_MS)).toBe(true)
    expect(intervals.slice(100).every((ms) => ms === HOST_POLL_INTERVAL_MS)).toBe(true)
    expect(intervals.length).toBe(104)
    expect(hostPollInterval(999)).toBe(HOST_FAST_POLL_INTERVAL_MS)
    expect(hostPollInterval(1_000)).toBe(HOST_POLL_INTERVAL_MS)
  })

  it('says when it has launched a Host, before waiting for it to listen', async () => {
    const order: string[] = []
    const canConnect = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const launcher = dependencies({ canConnect })
    launcher.launch = vi.fn(() => {
      order.push('launch')
    })
    const probe = vi.fn(async () => {
      order.push('probe')
      return accepted
    })

    await ensureLocalSessionHost(
      { ...client, onLaunched: () => order.push('launched') },
      { ...launcher, probe },
    )

    expect(order.slice(0, 2)).toEqual(['launch', 'launched'])
  })

  it('says once that the running Host is handing over to an update', async () => {
    const pending = new LocalSessionHostUpgradePendingError('host-old', [], [])
    const onUpgradePending = vi.fn()
    const launcher = dependencies({ probe: vi.fn(async () => Promise.reject(pending)) })

    await expect(
      ensureLocalSessionHost({ ...client, takeoverTimeoutMs: 200, onUpgradePending }, launcher),
    ).rejects.toBe(pending)

    expect(onUpgradePending).toHaveBeenCalledOnce()
  })

  it('says once that the hand-off is done, before it launches the new Host', async () => {
    const pending = new LocalSessionHostUpgradePendingError('host-old', [], [])
    const order: string[] = []
    // The old Host answers "updating" twice, then stops listening; the new one listens at once.
    const canConnect = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    const probe = vi
      .fn()
      .mockRejectedValueOnce(pending)
      .mockRejectedValueOnce(pending)
      .mockResolvedValue(accepted)
    const launcher = dependencies({ canConnect, probe })
    launcher.launch = vi.fn(() => {
      order.push('launch')
    })

    await ensureLocalSessionHost(
      {
        ...client,
        onUpgradePending: () => order.push('updating'),
        onUpgradeReleased: () => order.push('updated'),
      },
      launcher,
    )

    expect(order).toEqual(['updating', 'updated', 'launch'])
  })

  it('never says a hand-off is done when there was none', async () => {
    const onUpgradeReleased = vi.fn()
    await ensureLocalSessionHost({ ...client, onUpgradeReleased }, dependencies())

    expect(onUpgradeReleased).not.toHaveBeenCalled()
  })

  it('asks a Host launched by a measuring GUI to mark its startup too', () => {
    expect(
      sessionHostChildEnvironment({
        safeEnvironment: { PATH: '/usr/bin' },
        userDataRoot: '/profile',
        startupTimings: true,
      }),
    ).toEqual({
      PATH: '/usr/bin',
      OPENWAGGLE_USER_DATA_DIR: '/profile',
      OPENWAGGLE_STARTUP_TIMINGS: '1',
    })
    expect(
      sessionHostChildEnvironment({ safeEnvironment: {}, userDataRoot: '/profile' }),
    ).not.toHaveProperty('OPENWAGGLE_STARTUP_TIMINGS')
  })
})
