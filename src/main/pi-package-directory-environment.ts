/**
 * Pi finds its README, docs, themes, export templates, and `VERSION` by walking up from its module
 * file to the nearest package.json. Bundled into OpenWaggle's main chunk, that walk reaches
 * OpenWaggle's package.json, so OpenWaggle always sets Pi's own `PI_PACKAGE_DIR` override for its
 * main process and Session Host (`applyPiPackageDirectory` in env.ts), even over a value the user
 * set for another Pi install, and gives the shells it starts the user's own value back.
 */
export const PI_PACKAGE_DIR_VARIABLE = 'PI_PACKAGE_DIR'

interface PiPackageDirectoryState {
  /** The `PI_PACKAGE_DIR` OpenWaggle set for its own bundled Pi. */
  readonly bundled: string
  /** The value the user's environment had before, for the shells OpenWaggle starts. */
  readonly user: string | undefined
}

let state: PiPackageDirectoryState | undefined

/** Points OpenWaggle's bundled Pi at `directory`, remembering the user's own value. */
export function applyPiPackageDirectoryTo(
  directory: string | undefined,
  environment: Record<string, string | undefined>,
) {
  if (!directory) return
  const current = environment[PI_PACKAGE_DIR_VARIABLE]
  const user = state && current === state.bundled ? state.user : current
  environment[PI_PACKAGE_DIR_VARIABLE] = directory
  state = { bundled: directory, user }
}

/**
 * The environment a shell or child process OpenWaggle starts should see: OpenWaggle's own
 * `PI_PACKAGE_DIR` replaced by the user's value, or removed when the user had none, so a
 * standalone `pi` finds its own package. Any other value is kept.
 */
export function withShellPiPackageDirectory<V extends string | undefined>(
  environment: Readonly<Record<string, V>>,
): Record<string, V | string> {
  const current = state
  if (!current || environment[PI_PACKAGE_DIR_VARIABLE] !== current.bundled)
    return { ...environment }
  const shellEnvironment: Record<string, V | string> = {}
  for (const [name, value] of Object.entries(environment)) {
    if (name !== PI_PACKAGE_DIR_VARIABLE) shellEnvironment[name] = value
  }
  if (current.user !== undefined) shellEnvironment[PI_PACKAGE_DIR_VARIABLE] = current.user
  return shellEnvironment
}
