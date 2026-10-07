/**
 * Pi finds its README, docs, themes, export templates, and `VERSION` by walking up from its module
 * file to the nearest package.json. Bundled into OpenWaggle's main chunk, that walk reaches
 * OpenWaggle's package.json, so OpenWaggle sets Pi's own `PI_PACKAGE_DIR` override for itself
 * (`applyPiPackageDirectory` in env.ts) and keeps that value out of the shells it starts.
 */
export const PI_PACKAGE_DIR_VARIABLE = 'PI_PACKAGE_DIR'

/** The `PI_PACKAGE_DIR` OpenWaggle set for its own bundled Pi, if it set one. */
let injectedPiPackageDirectory: string | undefined

/** Sets Pi's `PI_PACKAGE_DIR` to `directory`, keeping a value the user already set. */
export function applyPiPackageDirectoryTo(
  directory: string | undefined,
  environment: Record<string, string | undefined>,
) {
  if (!directory || environment[PI_PACKAGE_DIR_VARIABLE]) return
  environment[PI_PACKAGE_DIR_VARIABLE] = directory
  injectedPiPackageDirectory = directory
}

/**
 * The environment without the `PI_PACKAGE_DIR` OpenWaggle set for itself, so a standalone `pi`
 * run in an agent or terminal shell still finds its own package. A user's own value is kept.
 */
export function withoutInjectedPiPackageDirectory<V extends string | undefined>(
  environment: Readonly<Record<string, V>>,
): Record<string, V> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name, value]) =>
        !injectedPiPackageDirectory ||
        name !== PI_PACKAGE_DIR_VARIABLE ||
        value !== injectedPiPackageDirectory,
    ),
  )
}
