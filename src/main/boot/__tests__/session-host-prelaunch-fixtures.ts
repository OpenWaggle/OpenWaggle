import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { fromAny } from '@total-typescript/shoehorn'
import { type Mock, vi } from 'vitest'
import type { DetachedProcessLaunch } from '../../detached-process'
import type { SessionHostPrelaunch } from '../../session-host/session-host-prelaunch-handoff'
import type { SessionHostPrelaunchInput } from '../session-host-prelaunch'

export const PROFILE = '/Users/person/Library/Application Support/openwaggle'

export class FakeChild extends EventEmitter {
  readonly unref: Mock<() => void> = vi.fn()
}

export function prelaunchInput(overrides: Partial<SessionHostPrelaunchInput> = {}) {
  const child = new FakeChild()
  const spawn = vi.fn((_launch: DetachedProcessLaunch) => fromAny<ChildProcess, FakeChild>(child))
  const record = vi.fn<(prelaunch: SessionHostPrelaunch) => void>()
  const switches = new Set<string>(['use-mock-keychain'])
  const input: SessionHostPrelaunchInput = {
    app: {
      isPackaged: true,
      getAppPath: () => '/Applications/OpenWaggle.app/Contents/Resources/app',
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
    executablePath: '/Applications/OpenWaggle.app/Contents/MacOS/bun',
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
