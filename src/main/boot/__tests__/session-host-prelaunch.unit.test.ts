import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fromAny } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import type { DetachedProcessLaunch } from '../../detached-process'
import { resolveLocalSessionHostPaths } from '../../session-host/local-session-paths'
import type { SessionHostPrelaunch } from '../../session-host/session-host-prelaunch-handoff'
import {
  type SessionHostPrelaunchDecisionInput,
  type SessionHostPrelaunchInput,
  sessionHostPrelaunchDecision,
  startSessionHostPrelaunch,
} from '../session-host-prelaunch'

vi.mock('electron', () => ({ app: {} }))

const PROFILE = '/Users/person/Library/Application Support/openwaggle'
const ENDPOINT = `${PROFILE}/session-host/host.sock`
const TARGET_DATABASE = `${PROFILE}/session-host/session-host.sqlite`
const LEGACY_DATABASE = `${PROFILE}/openwaggle.db`
const TEMPORARY_ROOT = '/var/folders/xy/T'

function decide(overrides: Partial<SessionHostPrelaunchDecisionInput> = {}) {
  return sessionHostPrelaunchDecision({
    platform: 'darwin',
    desktopApp: true,
    userDataRoot: PROFILE,
    temporaryRoot: () => TEMPORARY_ROOT,
    pathExists: () => false,
    legacyStorePresent: () => false,
    ...overrides,
  })
}

describe('sessionHostPrelaunchDecision', () => {
  it('launches for a desktop-app start whose profile has no Host socket', () => {
    expect(decide()).toEqual({ kind: 'launch' })
  })

  it('leaves CLI commands, the Host itself and Windows to their usual paths', () => {
    expect(decide({ desktopApp: false })).toEqual({ kind: 'skip', reason: 'not-desktop-app' })
    expect(decide({ platform: 'win32' })).toEqual({ kind: 'skip', reason: 'windows-named-pipe' })
    expect(decide({ userDataRoot: 'relative/profile' })).toEqual({
      kind: 'skip',
      reason: 'relative-profile',
    })
  })

  it('does not launch while a socket shows a Host may be running, updating or crashed', () => {
    const pathExists = vi.fn((target: string) => target === ENDPOINT)

    expect(decide({ pathExists })).toEqual({ kind: 'skip', reason: 'host-socket-present' })
  })

  it('finds the socket of a profile whose own path is too long, in the Host temp directory', () => {
    const longProfile = `/Users/person/${'nested/'.repeat(12)}openwaggle`
    const { endpoint } = resolveLocalSessionHostPaths({
      userDataRoot: longProfile,
      platform: 'darwin',
      temporaryRoot: TEMPORARY_ROOT,
    })
    expect(endpoint.startsWith(TEMPORARY_ROOT)).toBe(true)

    expect(
      decide({ userDataRoot: longProfile, pathExists: (target) => target === endpoint }),
    ).toEqual({ kind: 'skip', reason: 'host-socket-present' })
  })

  it('leaves a legacy store to the GUI, which moves it under its single-instance lock', () => {
    const legacyStorePresent = (target: string) => target === LEGACY_DATABASE

    expect(decide({ legacyStorePresent })).toEqual({ kind: 'skip', reason: 'legacy-store-to-move' })
    // Already moved, or nothing in it (#357): nothing for the GUI to move first.
    expect(
      decide({ legacyStorePresent, pathExists: (target) => target === TARGET_DATABASE }),
    ).toEqual({
      kind: 'launch',
    })
    expect(decide({ legacyStorePresent: () => false })).toEqual({ kind: 'launch' })
  })
})

class FakeChild extends EventEmitter {
  readonly unref = vi.fn()
}

function prelaunchInput(overrides: Partial<SessionHostPrelaunchInput> = {}) {
  const child = new FakeChild()
  const spawn = vi.fn((_launch: DetachedProcessLaunch) => fromAny<ChildProcess, FakeChild>(child))
  const record = vi.fn<(prelaunch: SessionHostPrelaunch) => void>()
  const switches = new Set<string>(['use-mock-keychain'])
  const input: SessionHostPrelaunchInput = {
    app: {
      isPackaged: true,
      getAppPath: () => '/Applications/OpenWaggle.app/Contents/Resources/app.asar',
      getPath: () => PROFILE,
      commandLine: {
        hasSwitch: (name) => switches.has(name),
        getSwitchValue: () => '',
      },
    },
    desktopApp: true,
    environment: {
      PATH: '/usr/bin',
      HOME: '/Users/person',
      TMPDIR: '/agent/scratch',
      OPENWAGGLE_HOST_TMPDIR: '/var/folders/xy/T',
      OPENWAGGLE_PROFILE: 'agent-profile',
      OPENWAGGLE_AGENT_RUN: '1',
      ELECTRON_RUN_AS_NODE: '1',
      OPENWAGGLE_LOG_LEVEL: 'debug',
      OPENWAGGLE_STARTUP_TIMINGS: '1',
      ANTHROPIC_API_KEY: 'provider-key',
      OPENWAGGLE_SHELL_ENVIRONMENT_REFRESHED_SINCE: '1',
    },
    platform: 'darwin',
    executablePath: '/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle',
    homeDirectory: '/Users/person',
    temporaryDirectory: () => '/agent/scratch',
    now: () => 1_800_000_000_000,
    pathExists: () => false,
    legacyStorePresent: () => false,
    spawn,
    record,
    ...overrides,
  }
  return { input, child, spawn, record, switches }
}

describe('startSessionHostPrelaunch', () => {
  it('leaves an empty legacy database whose WAL holds frames to the GUI, as the Host would', async () => {
    const profile = await mkdtemp(path.join(tmpdir(), 'ow-prelaunch-'))
    try {
      await writeFile(path.join(profile, 'openwaggle.db'), '')
      await writeFile(path.join(profile, 'openwaggle.db-wal'), 'wal frames')
      const { input, spawn } = prelaunchInput({
        app: { ...prelaunchInput().input.app, getPath: () => profile },
        temporaryDirectory: () => profile,
      })
      const { pathExists: _pathExists, legacyStorePresent: _legacyStorePresent, ...real } = input

      expect(startSessionHostPrelaunch(real)).toEqual({
        kind: 'skip',
        reason: 'legacy-store-to-move',
      })
      expect(spawn).not.toHaveBeenCalled()

      // With no WAL frames it holds nothing, and the Host is launched.
      await writeFile(path.join(profile, 'openwaggle.db-wal'), '')
      expect(startSessionHostPrelaunch(real)).toEqual({ kind: 'launch' })
    } finally {
      await rm(profile, { recursive: true, force: true })
    }
  })

  it("launches the Host as the GUI would, with the Host's environment, and records it", () => {
    const { input, spawn, record } = prelaunchInput()

    expect(startSessionHostPrelaunch(input)).toEqual({ kind: 'launch' })

    expect(spawn).toHaveBeenCalledOnce()
    const launch = spawn.mock.calls[0]?.[0]
    expect(launch?.command).toBe('/Applications/OpenWaggle.app/Contents/MacOS/OpenWaggle')
    expect(launch?.args).toEqual(['--use-mock-keychain', 'session-host-internal'])
    expect(launch?.environment).toMatchObject({
      OPENWAGGLE_USER_DATA_DIR: PROFILE,
      OPENWAGGLE_LOG_LEVEL: 'debug',
      OPENWAGGLE_STARTUP_TIMINGS: '1',
      // Provider credentials stay: the Host owns Runs.
      ANTHROPIC_API_KEY: 'provider-key',
      // An agent shell's scratch directory is not the Host's temp directory (ADR 0042).
      TMPDIR: '/var/folders/xy/T',
      // The app this shim starts refreshes the login-shell cache; the Host waits for that.
      OPENWAGGLE_SHELL_ENVIRONMENT_REFRESHED_SINCE: '1800000000000',
    })
    expect(launch?.environment.PATH?.startsWith('/usr/bin')).toBe(true)
    for (const clientScoped of [
      'OPENWAGGLE_PROFILE',
      'OPENWAGGLE_AGENT_RUN',
      'ELECTRON_RUN_AS_NODE',
    ]) {
      expect(launch?.environment).not.toHaveProperty(clientScoped)
    }
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ userDataRoot: PROFILE }))
  })

  it('gives a Linux Host the session bus the GUI used to hydrate before launching it', () => {
    const linux = (overrides: Partial<SessionHostPrelaunchInput>) => {
      const { input, spawn } = prelaunchInput({
        platform: 'linux',
        executablePath: '/opt/OpenWaggle/openwaggle',
        ...overrides,
      })
      startSessionHostPrelaunch(input)
      return spawn.mock.calls[0]?.[0]?.environment
    }
    const runtime = { ...prelaunchInput().input.environment, XDG_RUNTIME_DIR: '/run/user/1000' }

    expect(
      linux({ environment: runtime, pathExists: (target) => target === '/run/user/1000/bus' }),
    ).toMatchObject({ DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' })
    // Without XDG_RUNTIME_DIR, the user's own runtime directory.
    expect(
      linux({ uid: 1001, pathExists: (target) => target === '/run/user/1001/bus' }),
    ).toMatchObject({ DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1001/bus' })
    // The launch's own address wins, and no bus means none is made up.
    expect(
      linux({
        environment: { ...runtime, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/dbus-launch' },
        pathExists: () => false,
      }),
    ).toMatchObject({ DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/dbus-launch' })
    expect(linux({ environment: runtime, pathExists: () => false })).not.toHaveProperty(
      'DBUS_SESSION_BUS_ADDRESS',
    )
  })

  it('launches for the profile OPENWAGGLE_USER_DATA_DIR names', () => {
    const profile = '/tmp/qa-profile/user-data'
    const { input, spawn } = prelaunchInput()

    startSessionHostPrelaunch({
      ...input,
      environment: { ...input.environment, OPENWAGGLE_USER_DATA_DIR: profile },
    })

    expect(spawn.mock.calls[0]?.[0]?.environment.OPENWAGGLE_USER_DATA_DIR).toBe(profile)
  })

  it('records a Host that ends once its process exits or cannot start', () => {
    const { input, child, record } = prelaunchInput()
    startSessionHostPrelaunch(input)
    const prelaunch = record.mock.calls[0]?.[0]
    expect(prelaunch?.hasEnded()).toBe(false)

    child.emit('spawn')
    expect(child.unref).toHaveBeenCalledOnce()
    child.emit('exit', 0, null)

    expect(prelaunch?.hasEnded()).toBe(true)
    return expect(prelaunch?.ended).resolves.toBeUndefined()
  })

  it('launches nothing when the start would not launch a Host', () => {
    const { input, spawn, record } = prelaunchInput({
      pathExists: (target) => target === path.join(PROFILE, 'session-host', 'host.sock'),
    })

    expect(startSessionHostPrelaunch(input)).toEqual({
      kind: 'skip',
      reason: 'host-socket-present',
    })
    expect(spawn).not.toHaveBeenCalled()
    expect(record).not.toHaveBeenCalled()
  })

  it('never fails the start it speeds up: a failed launch leaves the GUI its own', () => {
    const { input, record } = prelaunchInput({
      spawn: () => {
        throw new Error('EMFILE')
      },
    })

    expect(startSessionHostPrelaunch(input)).toBeNull()
    expect(record).not.toHaveBeenCalled()
  })
})
