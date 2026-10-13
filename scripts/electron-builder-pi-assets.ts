import path from 'node:path'

/**
 * Pi resolves its README, docs, and examples from its package directory and names them to the
 * model (the system prompt's Pi documentation paths, codemode's `docs/codemode.md`). electron-builder
 * drops a module's top-level README and examples and OpenWaggle's file patterns drop every `docs`
 * directory, so the packaged app needs Pi's own copies forced back in.
 */
const PI_PACKAGE_SEGMENTS = ['@earendil-works', 'pi-coding-agent'] as const
const PI_PACKAGE_TOP_LEVEL_ASSETS = ['README.md', 'docs', 'examples'] as const

/** `onNodeModuleFile` for electron-builder: keep Pi's own top-level documentation. */
export function forceIncludePiPackageAsset(filePath: string): boolean {
  const name = path.basename(filePath)
  if (!PI_PACKAGE_TOP_LEVEL_ASSETS.some((asset) => asset === name)) return false
  const packageDirectory = path.dirname(filePath)
  return (
    path.basename(packageDirectory) === PI_PACKAGE_SEGMENTS[1] &&
    path.basename(path.dirname(packageDirectory)) === PI_PACKAGE_SEGMENTS[0]
  )
}

/** File patterns re-including Pi's docs after OpenWaggle's generic `node_modules/**` exclusions. */
export const PI_PACKAGE_ASSET_FILE_PATTERNS = [
  'node_modules/@earendil-works/pi-coding-agent/README.md',
  'node_modules/@earendil-works/pi-coding-agent/docs/**/*',
  'node_modules/@earendil-works/pi-coding-agent/examples/**/*',
] as const

/** asar entries the packaged app must hold for Pi's documentation paths to resolve. */
export const PACKAGED_PI_ASSET_ENTRIES = [
  '/node_modules/@earendil-works/pi-coding-agent/README.md',
  '/node_modules/@earendil-works/pi-coding-agent/docs/codemode.md',
  '/node_modules/@earendil-works/pi-coding-agent/examples',
] as const

export function missingPackagedPiAssets(asarEntries: readonly string[]): string[] {
  const entries = new Set(asarEntries)
  return PACKAGED_PI_ASSET_ENTRIES.filter((entry) => !entries.has(entry))
}
