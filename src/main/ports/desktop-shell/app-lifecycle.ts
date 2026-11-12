import { Context } from 'effect'
import type { CancellableShellEvent, Unsubscribe } from './shell-events'

/**
 * Switches the shell's engine reads from its command line (`--disk-cache-size`,
 * `--remote-debugging-port`, OpenWaggle's own `--openwaggle-*` switches). A shell whose engine
 * takes no switches answers `false`/`''` and ignores `append`.
 */
export interface ShellCommandLineShape {
  readonly hasSwitch: (name: string) => boolean
  /** The switch's value, or `''` when it is absent or has none. */
  readonly getSwitchValue: (name: string) => string
  /** Adds a switch for this process's engine; only before the app is ready. */
  readonly appendSwitch: (name: string, value?: string) => void
}

/**
 * The app process's identity and lifecycle (ADR 0064).
 *
 * Quitting follows one protocol on every shell: `quit()` asks every `onBeforeQuit` listener
 * first, and a listener that calls `preventDefault()` holds the quit open while it finishes async
 * shutdown, then calls `quit()` again. `exit()` ends the process at once, without asking. A shell
 * whose own before-quit hook cannot wait (Electrobun's is synchronous) must still honour a held
 * quit by routing its own quit signals through this protocol.
 */
export interface AppLifecycleShape {
  /** The app's version from its `package.json` (`1.0.0-beta.37`). */
  readonly version: () => string
  /** The app's product name, which also names the Dev build's `userData` directory. */
  readonly name: () => string
  /** `true` in an installed build, `false` when run from a source checkout. */
  readonly isPackaged: () => boolean
  /** Resolves once the shell can create windows and read every path. */
  readonly whenReady: () => Promise<void>
  readonly quit: () => void
  readonly exit: (code?: number) => void
  /** Starts the app again once this process quits; call `quit()` after it. */
  readonly relaunch: () => void
  readonly onBeforeQuit: (listener: (event: CancellableShellEvent) => void) => Unsubscribe
  /** The last chance to write synchronously before the process ends. */
  readonly onWillQuit: (listener: () => void) => Unsubscribe
  /**
   * Every window closed. Registering a listener replaces the shell's default of quitting, so
   * Session terminals survive a closed window on macOS.
   */
  readonly onWindowAllClosed: (listener: () => void) => Unsubscribe
  /** macOS: the Dock icon was clicked or the app was reopened. */
  readonly onActivate: (listener: () => void) => Unsubscribe
  /**
   * The platform installer (Squirrel.Mac, the Windows installer) is about to quit the app to
   * install an update, including one the install watchdog stopped waiting for.
   */
  readonly onBeforeQuitForUpdate: (listener: () => void) => Unsubscribe
  readonly commandLine: ShellCommandLineShape
  /** Turns GPU compositing off for a windowless process; only before ready. */
  readonly disableHardwareAcceleration: () => void
}

export class AppLifecycle extends Context.Tag('@openwaggle/AppLifecycle')<
  AppLifecycle,
  AppLifecycleShape
>() {}
