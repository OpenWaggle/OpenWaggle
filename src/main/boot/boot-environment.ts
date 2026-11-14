/**
 * The variables the boot shim and what it imports read by name, as a declared view over an
 * environment map (`process.env`, or a copy made for a child). The shim loads no OpenWaggle
 * runtime, so there is no schema here: an environment holds only strings, and every variable is
 * optional. Main-bundle code reads them through `env.ts` instead.
 */
export interface BootEnvironment {
  readonly PATH?: string
  readonly APPIMAGE?: string
  readonly LOCALAPPDATA?: string
  readonly XDG_CACHE_HOME?: string
  readonly XDG_RUNTIME_DIR?: string
  readonly DBUS_SESSION_BUS_ADDRESS?: string
  readonly OPENWAGGLE_CLI_OUTPUT_FD?: string
  readonly OPENWAGGLE_HOST_TMPDIR?: string
  readonly OPENWAGGLE_LOG_LEVEL?: string
  readonly OPENWAGGLE_USER_DATA_DIR?: string
  readonly OPENWAGGLE_DISABLE_COMPILE_CACHE?: string
  readonly OPENWAGGLE_COMPILE_CACHE_DIR?: string
}
