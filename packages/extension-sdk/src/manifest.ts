import type { OPENWAGGLE_EXTENSION } from './constants.js'
import type { OpenWaggleExtensionManifest } from './generated/manifest.js'

export type * from './generated/manifest.js'
export type OpenWaggleExtensionManifestFile = typeof OPENWAGGLE_EXTENSION.MANIFEST_FILE

/**
 * Returns the manifest unchanged, typed as precisely as it was written. It checks the shape at
 * compile time only; `validateExtensionManifest` from `@openwaggle/extension-sdk/validation`
 * checks a manifest at run time.
 */
export function defineExtensionManifest<const TManifest extends OpenWaggleExtensionManifest>(
  manifest: TManifest,
) {
  return manifest
}
