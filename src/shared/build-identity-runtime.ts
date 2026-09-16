import type { BuildChannel } from './types/build-identity'

/**
 * Runtime view of this build's {@link BuildChannel} identity, baked in at build
 * time by electron-vite `define` (see electron.vite.config.ts) from the same
 * resolver electron-builder uses. `typeof` guards keep this safe under vitest,
 * where the defines are absent and the identifiers are genuinely undeclared.
 */
declare const __OW_BUILD_CHANNEL__: BuildChannel
declare const __OW_BUILD_SLUG__: string | null
declare const __OW_PRODUCT_NAME__: string

export const BUILD_CHANNEL: BuildChannel =
  typeof __OW_BUILD_CHANNEL__ !== 'undefined' ? __OW_BUILD_CHANNEL__ : 'dev'

export const BUILD_SLUG: string | null =
  typeof __OW_BUILD_SLUG__ !== 'undefined' ? __OW_BUILD_SLUG__ : null

export const PRODUCT_NAME: string =
  typeof __OW_PRODUCT_NAME__ !== 'undefined' ? __OW_PRODUCT_NAME__ : 'OpenWaggle'
