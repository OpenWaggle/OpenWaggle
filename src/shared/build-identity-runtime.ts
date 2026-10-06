import type { BuildChannel } from './types/build-identity'

/**
 * Runtime view of this build's {@link BuildChannel} identity, baked in at build
 * time by electron-vite `define` (see electron.vite.config.ts) from the same
 * resolver electron-builder uses. `typeof` guards keep this safe under vitest,
 * where the defines are absent and the identifiers are genuinely undeclared.
 */
declare const __OW_BUILD_CHANNEL__: BuildChannel
declare const __OW_PRODUCT_NAME__: string
declare const __OW_APP_ID__: string

export const BUILD_CHANNEL: BuildChannel =
  typeof __OW_BUILD_CHANNEL__ !== 'undefined' ? __OW_BUILD_CHANNEL__ : 'dev'

export const PRODUCT_NAME: string =
  typeof __OW_PRODUCT_NAME__ !== 'undefined' ? __OW_PRODUCT_NAME__ : 'OpenWaggle'

/**
 * The PNG an unpackaged dev build sets as its macOS Dock icon at runtime, under build/. It matches
 * the generated rounded-square macOS icons (scripts/generate-macos-icons.ts).
 */
export const MAC_DEV_DOCK_ICON_FILE = 'icon-dev-macos.png'

/** The bundle identifier (macOS) and app id this build was packaged with. */
export const APP_ID: string =
  typeof __OW_APP_ID__ !== 'undefined' ? __OW_APP_ID__ : 'com.openwaggle.app'
