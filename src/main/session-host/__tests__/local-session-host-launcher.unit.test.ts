import {
  LOCAL_SESSION_CAPABILITIES,
  LOCAL_SESSION_CURRENT_REVISION,
  LOCAL_SESSION_PROTOCOL_NAME,
} from '@shared/types/local-session-protocol'
import { describe, expect, it, vi } from 'vitest'
import { LocalSessionHostUpgradePendingError } from '../local-session-client-connection'
import {
  ensureLocalSessionHost,
  isLocalSessionHostUnavailable,
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
  revision: LOCAL_SESSION_CURRENT_REVISION,
  hostInstanceId: 'host-current',
  capabilities: LOCAL_SESSION_CAPABILITIES,
}

function dependencies(input?: {
  readonly canConnect?: LocalSessionHostLauncherDependencies['canConnect']
  readonly probe?: LocalSessionHostLauncherDependencies['probe']
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
    wait: vi.fn(async (milliseconds: number) => {
      now += milliseconds
    }),
  } satisfies LocalSessionHostLauncherDependencies
}

const client = { paths, clientKind: 'cli' as const, clientVersion: 'current' }

describe('Local Session Host launcher', () => {
  it.each(['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'EPIPE'])(
    'classifies %s as a recoverable Host transport failure',
    (code) => {
      expect(isLocalSessionHostUnavailable(Object.assign(new Error(code), { code }))).toBe(true)
    },
  )

  it('does not classify application errors as Host transport failures', () => {
    expect(
      isLocalSessionHostUnavailable(Object.assign(new Error('denied'), { code: 'EACCES' })),
    ).toBe(false)
  })

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

  it('forwards the resolved profile without restoring ambient XDG configuration', () => {
    const environment = sessionHostChildEnvironment({
      safeEnvironment: {
        PATH: '/safe/bin',
        HOME: '/home/person',
      },
      userDataRoot: '/tmp/xdg/OpenWaggle',
    })

    expect(environment).toMatchObject({
      HOME: '/home/person',
      OPENWAGGLE_USER_DATA_DIR: '/tmp/xdg/OpenWaggle',
    })
    expect(environment).not.toHaveProperty('XDG_CONFIG_HOME')
  })

  it('forwards a resolved Windows profile without restoring ambient app-data variables', () => {
    const environment = sessionHostChildEnvironment({
      safeEnvironment: {
        PATH: 'C:\\Windows\\System32',
        SystemRoot: 'C:\\Windows',
      },
      userDataRoot: 'D:\\Profiles\\OpenWaggle',
    })

    expect(environment.OPENWAGGLE_USER_DATA_DIR).toBe('D:\\Profiles\\OpenWaggle')
    expect(environment).not.toHaveProperty('APPDATA')
    expect(environment).not.toHaveProperty('LOCALAPPDATA')
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
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    const probe = vi.fn().mockRejectedValueOnce(pending).mockResolvedValue(accepted)
    const tryAcquireOwnership = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        targetPath: paths.databasePath,
        release: vi.fn(async () => undefined),
      })
    const launcher = dependencies({ canConnect, probe, tryAcquireOwnership })

    await expect(ensureLocalSessionHost(client, launcher)).resolves.toEqual(accepted)

    expect(launcher.launch).toHaveBeenCalledOnce()
    expect(launcher.wait).toHaveBeenCalled()
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it('attaches when a compatible endpoint appears while ownership stays fenced', async () => {
    const canConnect = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const tryAcquireOwnership = vi.fn(async () => null)
    const launcher = dependencies({ canConnect, tryAcquireOwnership })

    await expect(
      ensureLocalSessionHost({ ...client, takeoverTimeoutMs: 100 }, launcher),
    ).resolves.toEqual(accepted)
    expect(launcher.launch).not.toHaveBeenCalled()
    expect(tryAcquireOwnership).toHaveBeenCalledOnce()
  })

  it('preserves upgrade blockers when ownership is not released before the deadline', async () => {
    const pending = new LocalSessionHostUpgradePendingError(
      'host-old',
      [{ sessionId: 'session-live', runId: 'run-live' }],
      [],
    )
    const launcher = dependencies({
      probe: vi.fn(async () => Promise.reject(pending)),
      tryAcquireOwnership: vi.fn(async () => null),
    })

    await expect(
      ensureLocalSessionHost({ ...client, takeoverTimeoutMs: 100 }, launcher),
    ).rejects.toBe(pending)

    expect(launcher.launch).not.toHaveBeenCalled()
  })
})
