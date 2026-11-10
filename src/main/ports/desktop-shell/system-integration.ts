import { Context } from 'effect'
import type { CancellableShellEvent, Unsubscribe } from './shell-events'

/** A later launch of the app, handed to the running instance. */
export interface SecondInstanceLaunch {
  readonly argv: readonly string[]
  readonly workingDirectory: string
  /** What the later launch passed to `requestSingleInstanceLock`. */
  readonly additionalData: unknown
}

/** A Windows login item: the executable and the arguments it starts with. */
export interface LoginItem {
  readonly path: string
  readonly args: readonly string[]
}

/**
 * Which kind of process ended unexpectedly: `renderer` for a page's renderer, otherwise the
 * shell's own name for a helper (`GPU`, `Utility`, ...).
 */
export interface ShellProcessExit {
  readonly process: string
  /** `crashed`, `oom`, `killed`, `abnormal-exit`, `launch-failed`, `integrity-failure`, ... */
  readonly reason: string
}

/**
 * How the app fits into the operating system (ADR 0064): one running instance, login items,
 * the Dock and taskbar, wake from sleep, `openwaggle:` links and crashed engine processes.
 */
export interface SystemIntegrationShape {
  /**
   * Becomes the only running instance, or returns `false` when another holds the lock; that
   * instance then receives `additionalData` through `onSecondInstance`.
   */
  readonly requestSingleInstanceLock: (additionalData?: Record<string, string>) => boolean
  readonly hasSingleInstanceLock: () => boolean
  readonly releaseSingleInstanceLock: () => void
  readonly onSecondInstance: (listener: (launch: SecondInstanceLaunch) => void) => Unsubscribe
  /** Windows only: whether the item starts at login. */
  readonly loginItemOpensAtLogin: (item: LoginItem) => boolean
  /** Windows only: registers the item to start at login, or removes it. */
  readonly setLoginItemOpensAtLogin: (item: LoginItem, openAtLogin: boolean) => void
  /** The Dock (macOS) or launcher (Linux, where supported) count; 0 hides it. */
  readonly setBadgeCount: (count: number) => void
  /** macOS: `accessory` keeps the app out of the Dock and the app switcher. */
  readonly setActivationPolicy: (policy: 'regular' | 'accessory' | 'prohibited') => void
  /** macOS: the Dock icon of an unpackaged build. */
  readonly setDockIcon: (iconPath: string) => void
  /** Windows: the AppUserModelID that groups windows and notifications. */
  readonly setAppUserModelId: (id: string) => void
  /** The system woke from sleep; timers may have fired late. */
  readonly onResume: (listener: () => void) => Unsubscribe
  /**
   * Registers this executable as the handler of `scheme:` links. Returns `false` when the
   * system refused. macOS and Linux declare the scheme in the bundle or desktop entry instead.
   */
  readonly setAsDefaultProtocolClient: (scheme: string) => boolean
  /** macOS: the system opened a link of a scheme the app claims. */
  readonly onOpenUrl: (listener: (event: CancellableShellEvent, url: string) => void) => Unsubscribe
  /** A renderer or helper process of the shell's engine ended unexpectedly. */
  readonly onProcessGone: (listener: (exit: ShellProcessExit) => void) => Unsubscribe
}

export class SystemIntegration extends Context.Tag('@openwaggle/SystemIntegration')<
  SystemIntegration,
  SystemIntegrationShape
>() {}
