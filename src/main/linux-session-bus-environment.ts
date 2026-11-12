/**
 * Fills `DBUS_SESSION_BUS_ADDRESS` on Linux from the user's runtime directory when the launch
 * environment lacks it, as the login-shell hydration does. It is synchronous and imports nothing,
 * so the boot shim and the Session Host apply it before Electron is ready: Electron's
 * `safeStorage` picks and reaches its Linux secret store from the process environment, and the
 * Host used to inherit this value from a GUI that hydrated before launching it.
 */
export interface LinuxSessionBusEnvironmentInput {
  readonly platform: NodeJS.Platform
  readonly uid?: number
  readonly exists: (path: string) => boolean
}

export function fillLinuxSessionBusAddress(
  env: Record<string, string | undefined>,
  input: LinuxSessionBusEnvironmentInput,
) {
  if (input.platform !== 'linux' || env.DBUS_SESSION_BUS_ADDRESS?.trim()) return
  const runtimeDirectories = [env.XDG_RUNTIME_DIR?.trim()]
  if (input.uid !== undefined) runtimeDirectories.push(`/run/user/${input.uid}`)
  for (const runtimeDirectory of runtimeDirectories) {
    if (!runtimeDirectory) continue
    const busPath = `${runtimeDirectory.replace(/\/+$/u, '')}/bus`
    if (!input.exists(busPath)) continue
    env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${busPath}`
    return
  }
}
