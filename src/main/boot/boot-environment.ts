/**
 * The variables the boot shim and what it imports read by name, as a declared view over an
 * environment map (`process.env`, or a copy made for a child). The shim loads no OpenWaggle
 * runtime, so there is no schema here: an environment holds only strings, and every variable is
 * optional. Main-bundle code reads them through `env.ts` instead.
 */
export interface BootEnvironment {
  readonly PATH?: string | undefined
  readonly APPIMAGE?: string | undefined
  readonly LOCALAPPDATA?: string | undefined
  readonly XDG_CACHE_HOME?: string | undefined
  readonly XDG_RUNTIME_DIR?: string | undefined
  readonly DBUS_SESSION_BUS_ADDRESS?: string | undefined
  readonly OPENWAGGLE_CLI_OUTPUT_FD?: string | undefined
  readonly OPENWAGGLE_HOST_TMPDIR?: string | undefined
  readonly OPENWAGGLE_LOG_LEVEL?: string | undefined
  readonly OPENWAGGLE_USER_DATA_DIR?: string | undefined
  readonly OPENWAGGLE_DISABLE_COMPILE_CACHE?: string | undefined
  readonly OPENWAGGLE_COMPILE_CACHE_DIR?: string | undefined
}
