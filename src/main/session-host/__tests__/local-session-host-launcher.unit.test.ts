import {
  LOCAL_SESSION_CAPABILITIES,
  LOCAL_SESSION_PROTOCOL_NAME,
} from '@shared/types/local-session-protocol'
import { describe, expect, it, vi } from 'vitest'
import { LocalSessionHostUpgradePendingError } from '../local-session-client-connection'
import {
  ensureLocalSessionHost,
  type LocalSessionHostLauncherDependencies,
  sessionHostChildEnvironment,
  sessionHostLaunchArguments,
} from '../local-session-host-launcher'

const paths = {
  stateRoot: '/state',
  legacyDatabasePath: '/state/legacy.sqlite',
  databasePath: '/state/host.sqlite',
  recoveryDatabasePath: '/state/recovery.sqlite',
  credentialPath: '/state/credential',
  endpoint: '/state/host.sock',
  endpointDirectory: '/state',
}

const accepted = {
  accepted: true as const,
  protocol: LOCAL_SESSION_PROTOCOL_NAME,
  revision: 2 as const,
  hostInstanceId: 'host-current',
  capabilities: LOCAL_SESSION_CAPABILITIES,
}

function dependencies(input?: {
  readonly canConnect?: LocalSessionHostLauncherDependencies['canConnect']
  readonly probe?: LocalSessionHostLauncherDependencies['probe']
}) {
  let now = 0
  return {
    canConnect: input?.canConnect ?? vi.fn(async () => true),
    probe: input?.probe ?? vi.fn(async () => accepted),
    launch: vi.fn(),
    now: () => now,
    wait: vi.fn(async (milliseconds: number) => {
      now += milliseconds
    }),
  } satisfies LocalSessionHostLauncherDependencies
}

const client = { paths, clientKind: 'cli' as const, clientVersion: 'current' }

describe('Local Session Host launcher', () => {
  it('includes the Electron application path for a cold development Host', () => {
    expect(
      sessionHostLaunchArguments({ isPackaged: false, appPath: '/workspace/OpenWaggle' }),
    ).toEqual(['/workspace/OpenWaggle', 'session-host-internal'])
    expect(
      sessionHostLaunchArguments({ isPackaged: true, appPath: '/Applications/OpenWaggle.app' }),
    ).toEqual(['session-host-internal'])
  })

  it('launches the detached Host with an explicit secret-free Electron environment', () => {
    const environment = sessionHostChildEnvironment({
      safeEnvironment: {
        PATH: '/safe/bin',
        HOME: '/Users/person',
      },
      userDataRoot: '/state/openwaggle-dev',
      logLevel: 'debug',
    })

    expect(environment).toEqual({
      PATH: '/safe/bin',
      HOME: '/Users/person',
      OPENWAGGLE_USER_DATA_DIR: '/state/openwaggle-dev',
      OPENWAGGLE_LOG_LEVEL: 'debug',
    })
    expect(environment).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    expect(environment).not.toHaveProperty('OPENAI_API_KEY')
  })

  it('reuses a compatible authenticated Host without launching another process', async () => {
    const launcher = dependencies()

    await expect(ensureLocalSessionHost(client, launcher)).resolves.toEqual(accepted)

    expect(launcher.probe).toHaveBeenCalledOnce()
    expect(launcher.launch).not.toHaveBeenCalled()
  })

  it('launches and verifies a Host when no process is listening', async () => {
    const canConnect = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const launcher = dependencies({ canConnect })

    await expect(ensureLocalSessionHost(client, launcher)).resolves.toEqual(accepted)

    expect(launcher.launch).toHaveBeenCalledOnce()
    expect(launcher.probe).toHaveBeenCalledTimes(2)
  })

  it('waits for an incompatible Host to drain before launching its replacement', async () => {
    const pending = new LocalSessionHostUpgradePendingError(
      'host-old',
      [{ sessionId: 'session-live', runId: 'run-live' }],
      [],
    )
    const canConnect = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    const probe = vi.fn().mockRejectedValueOnce(pending).mockResolvedValue(accepted)
    const launcher = dependencies({ canConnect, probe })

    await expect(ensureLocalSessionHost(client, launcher)).resolves.toEqual(accepted)

    expect(launcher.launch).toHaveBeenCalledOnce()
    expect(launcher.wait).toHaveBeenCalled()
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it('preserves upgrade blockers when ownership is not released before the deadline', async () => {
    const pending = new LocalSessionHostUpgradePendingError(
      'host-old',
      [{ sessionId: 'session-live', runId: 'run-live' }],
      [],
    )
    const launcher = dependencies({ probe: vi.fn(async () => Promise.reject(pending)) })

    await expect(
      ensureLocalSessionHost({ ...client, takeoverTimeoutMs: 100 }, launcher),
    ).rejects.toBe(pending)

    expect(launcher.launch).not.toHaveBeenCalled()
  })
})
