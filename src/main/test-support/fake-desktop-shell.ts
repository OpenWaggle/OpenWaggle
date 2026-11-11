import { vi } from 'vitest'
import type { AppLifecycleShape } from '../ports/desktop-shell/app-lifecycle'
import type { AppPathsShape } from '../ports/desktop-shell/app-paths'
import type { BootShellShape } from '../ports/desktop-shell/boot-shell'
import type { IpcMainTransportShape } from '../ports/desktop-shell/ipc-transport'
import type { SystemIntegrationShape } from '../ports/desktop-shell/system-integration'

/**
 * Test doubles for the desktop shell bindings (`src/main/desktop-shell/*`), for unit tests of the
 * code above the ports. A test mocks the binding module with one of these, for example:
 *
 *   vi.mock('../desktop-shell/app-lifecycle', async () => ({
 *     appLifecycle: (await import('../test-support/fake-desktop-shell')).fakeAppLifecycle(),
 *   }))
 *
 * The members that return nothing are `vi.fn`s, so a test may read their calls; the others are
 * plain functions, so `vi.resetAllMocks()` leaves them answering. A test overrides any member.
 */

type Listener = (...args: never[]) => void

/** Collects the listeners of one `on…` registration and calls them. */
function listenerSet<L extends Listener>() {
  const listeners = new Set<L>()
  return {
    listeners,
    register: (listener: L) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

function callEach(listeners: ReadonlySet<() => void>) {
  for (const listener of [...listeners]) listener()
}

export interface FakeAppLifecycle extends AppLifecycleShape {
  /** Runs the `onBeforeQuit` listeners; true when one of them held the quit. */
  readonly emitBeforeQuit: () => boolean
  readonly emitWillQuit: () => void
  readonly emitWindowAllClosed: () => void
  readonly emitActivate: () => void
  readonly emitBeforeQuitForUpdate: () => void
}

export function fakeAppLifecycle(overrides: Partial<AppLifecycleShape> = {}): FakeAppLifecycle {
  const beforeQuit = listenerSet<Parameters<AppLifecycleShape['onBeforeQuit']>[0]>()
  const willQuit = listenerSet<() => void>()
  const windowAllClosed = listenerSet<() => void>()
  const activate = listenerSet<() => void>()
  const beforeQuitForUpdate = listenerSet<() => void>()
  const lifecycle = {
    version: () => '1.0.0',
    name: () => 'OpenWaggle',
    isPackaged: () => false,
    whenReady: async () => undefined,
    quit: vi.fn(),
    exit: vi.fn(),
    relaunch: vi.fn(),
    onBeforeQuit: beforeQuit.register,
    onWillQuit: willQuit.register,
    onWindowAllClosed: windowAllClosed.register,
    onActivate: activate.register,
    onBeforeQuitForUpdate: beforeQuitForUpdate.register,
    commandLine: {
      appendSwitch: vi.fn(),
      hasSwitch: () => false,
      getSwitchValue: () => '',
    },
    disableHardwareAcceleration: vi.fn(),
    ...overrides,
  } satisfies AppLifecycleShape
  return Object.assign(lifecycle, {
    emitBeforeQuit: () => {
      let held = false
      for (const listener of [...beforeQuit.listeners]) {
        listener({ preventDefault: () => void (held = true) })
      }
      return held
    },
    emitWillQuit: () => callEach(willQuit.listeners),
    emitWindowAllClosed: () => callEach(windowAllClosed.listeners),
    emitActivate: () => callEach(activate.listeners),
    emitBeforeQuitForUpdate: () => callEach(beforeQuitForUpdate.listeners),
  })
}

export function fakeAppPaths(userData = '/tmp/openwaggle-test-profile'): AppPathsShape {
  const paths = { userData, logs: `${userData}/logs` }
  return {
    applyBuildIdentity: vi.fn(),
    userData: () => paths.userData,
    logs: () => paths.logs,
    appData: () => '/tmp',
    appRoot: () => '/tmp/openwaggle-app',
    resources: () => '/tmp/openwaggle-app/resources',
    setUserData: (directory: string) => void (paths.userData = directory),
    setLogs: (directory: string) => void (paths.logs = directory),
    setWebProfileData: vi.fn(),
  } satisfies AppPathsShape
}

const noUnsubscribe = () => undefined

export function fakeSystemIntegration(
  overrides: Partial<SystemIntegrationShape> = {},
): SystemIntegrationShape {
  return {
    requestSingleInstanceLock: () => true,
    hasSingleInstanceLock: () => true,
    releaseSingleInstanceLock: vi.fn(),
    onSecondInstance: () => noUnsubscribe,
    loginItemOpensAtLogin: () => false,
    setLoginItemOpensAtLogin: vi.fn(),
    setBadgeCount: vi.fn(),
    setActivationPolicy: vi.fn(),
    setDockIcon: vi.fn(),
    setAppUserModelId: vi.fn(),
    onResume: () => noUnsubscribe,
    setAsDefaultProtocolClient: () => true,
    onOpenUrl: () => noUnsubscribe,
    onProcessGone: () => noUnsubscribe,
    ...overrides,
  } satisfies SystemIntegrationShape
}

/** The boot shim's view of the shell, from the same fakes. */
export function fakeBootShell(overrides: Partial<BootShellShape> = {}): BootShellShape {
  const lifecycle = fakeAppLifecycle()
  const paths = fakeAppPaths()
  return {
    applyBuildIdentity: paths.applyBuildIdentity,
    appRoot: paths.appRoot,
    userData: paths.userData,
    version: lifecycle.version,
    isPackaged: lifecycle.isPackaged,
    exit: lifecycle.exit,
    commandLine: lifecycle.commandLine,
    setActivationPolicy: vi.fn(),
    ...overrides,
  } satisfies BootShellShape
}

/** Any channel's handler or listener; a test calls it with that channel's arguments. */
type AnyHandler = (...args: never) => unknown

/** An IpcMainTransport that keeps each channel's handler, so a test can call it. */
export function fakeIpcMainTransport() {
  const handlers = new Map<string, AnyHandler>()
  const listeners = new Map<string, AnyHandler[]>()
  const transport: IpcMainTransportShape = {
    handle: (channel, handler) => void handlers.set(channel, handler),
    on: (channel, listener) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener])
    },
  }
  return { transport, handlers, listeners }
}
