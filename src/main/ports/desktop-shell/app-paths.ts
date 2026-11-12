import { Context } from 'effect'

/**
 * Where OpenWaggle keeps its files (ADR 0064). Every directory here is the one Electron resolved
 * for this build before the shell move, so an existing install keeps its Sessions, settings,
 * databases and credentials in place:
 * - `userData`: the canonical `openwaggle` directory of a release build
 *   (`~/Library/Application Support/openwaggle`, `%APPDATA%\openwaggle`, `~/.config/openwaggle`);
 *   a Dev build uses its own product name instead, so it can never touch the installed release's
 *   data (ADR 0032). `OPENWAGGLE_USER_DATA_DIR` relocates it through `setUserData`.
 * - `logs`: the platform's log directory for the app (`~/Library/Logs/<name>` on macOS,
 *   `<userData>/logs` elsewhere), or the one `setLogs` chose.
 * - `appData`: the per-user application-data root that holds `userData` (`$XDG_CONFIG_HOME` or
 *   `~/.config` on Linux).
 * - `appRoot`: the directory holding the app's `package.json`: the source checkout when
 *   unpackaged, the packaged app's resources archive otherwise.
 *
 * Never derive a product directory from a shell default; resolve it here.
 */
export interface AppPathsShape {
  /**
   * Gives this build's `userData` its name (the Dev build's own product name); every entry point
   * calls it first, before anything reads a path.
   */
  readonly applyBuildIdentity: () => void
  readonly userData: () => string
  readonly logs: () => string
  readonly appData: () => string
  readonly appRoot: () => string
  /** Moves `userData` for this process; only before anything reads it (startup, before ready). */
  readonly setUserData: (directory: string) => void
  /** Moves `logs` for this process, as a relocated profile keeps its own logs. */
  readonly setLogs: (directory: string) => void
  /**
   * Where the shell's web engine keeps its own profile (caches, cookies, local storage of the
   * app's pages), before the app is ready. OpenWaggle keeps it in `<userData>/session-data` and
   * caps its HTTP cache (`CHROMIUM_HTTP_CACHE_MAX_BYTES`).
   */
  readonly setWebProfileData: (directory: string) => void
}

export class AppPaths extends Context.Tag('@openwaggle/AppPaths')<AppPaths, AppPathsShape>() {}
