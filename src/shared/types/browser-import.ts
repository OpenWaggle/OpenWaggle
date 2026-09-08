import type { BrowserProfile } from './browser-profile'

export const BROWSER_IMPORT_SOURCE_IDS = [
  'chrome',
  'edge',
  'brave',
  'vivaldi',
  'opera',
  'arc',
  'helium',
  'firefox',
  'safari',
] as const
export type BrowserImportSourceId = (typeof BROWSER_IMPORT_SOURCE_IDS)[number]

export const BROWSER_IMPORT_UNAVAILABLE_REASONS = [
  'not-installed',
  'needs-keychain-approval',
  'keychain-item-missing',
  'needs-full-disk-access',
  'browser-running',
  'unsupported-platform',
  'permission-denied',
] as const
export type BrowserImportUnavailableReason = (typeof BROWSER_IMPORT_UNAVAILABLE_REASONS)[number]

export const BROWSER_IMPORT_FAILURE_REASONS = [
  ...BROWSER_IMPORT_UNAVAILABLE_REASONS,
  'keychain-unavailable',
  'unknown-source',
  'unknown-source-profile',
  'unknown-target-profile',
  'session-unavailable',
  'read-failed',
  'resource-limit',
  'profile-not-saved',
  'profile-limit-reached',
  'profile-cleanup-failed',
] as const
export type BrowserImportFailureReason = (typeof BROWSER_IMPORT_FAILURE_REASONS)[number]

export interface BrowserImportSourceProfile {
  readonly directory: string
  readonly name: string
  readonly cookieCount?: number
}

export interface BrowserImportSource {
  readonly id: BrowserImportSourceId
  readonly name: string
  readonly profiles: readonly BrowserImportSourceProfile[]
  readonly unavailable?: BrowserImportUnavailableReason
}

export interface BrowserImportInput {
  readonly sourceId: BrowserImportSourceId
  readonly sourceProfileDirectory: string
  readonly targetProfileId: string
}

export interface BrowserImportResult {
  readonly imported: number
  readonly skipped: number
  readonly skippedDomains: readonly string[]
}

export type BrowserImportTarget =
  | { readonly kind: 'new'; readonly profileId: string }
  | { readonly kind: 'existing'; readonly profileId: string }

/**
 * Guided import request. The existing direct import request stays available for
 * callers that already manage a persistent destination profile.
 */
export interface GuidedBrowserImportInput {
  readonly sourceId: BrowserImportSourceId
  readonly sourceProfileDirectory: string
  readonly target: BrowserImportTarget
}

export type GuidedBrowserImportResult =
  | {
      readonly ok: true
      readonly result: BrowserImportResult
      readonly targetName: string
      /** Present only when this import registered a new persistent profile. */
      readonly createdProfile: BrowserProfile | null
    }
  | {
      readonly ok: false
      readonly reason: BrowserImportFailureReason
      readonly message: string
    }

export const BROWSER_IMPORT_FAILURE_COPY: Readonly<Record<BrowserImportFailureReason, string>> = {
  'not-installed': 'That browser is not installed on this machine.',
  'needs-keychain-approval':
    'Approve the Keychain access request so OpenWaggle can decrypt these cookies, then try again.',
  'keychain-item-missing':
    'No browser encryption key was found. Sign in to that browser once, quit it, then try again.',
  'needs-full-disk-access':
    'Give OpenWaggle Full Disk Access in System Settings, then check access again.',
  'browser-running': 'Quit the browser first so its cookie database can be read safely.',
  'unsupported-platform': 'This browser cannot be imported on this operating system.',
  'permission-denied':
    'OpenWaggle could not read the browser cookie files. Check their file permissions, then try again.',
  'keychain-unavailable':
    'The system credential store is unavailable. Unlock it or start your desktop keyring, then try again.',
  'unknown-source': 'That browser is no longer available to import from.',
  'unknown-source-profile': 'That browser profile no longer exists. Refresh the browser list.',
  'unknown-target-profile':
    'The destination profile no longer exists. Choose another profile and try again.',
  'session-unavailable': 'The destination browser profile could not be opened. Try again.',
  'read-failed': 'The browser cookie database could not be read. Quit the browser and try again.',
  'resource-limit':
    'The browser cookie store is too large or contains too many records to import safely.',
  'profile-not-saved':
    'The cookies were imported, but the new profile could not be saved. The imported data was cleared; try again.',
  'profile-limit-reached':
    'The browser profile limit was reached while the import ran. Delete a profile or use an existing one.',
  'profile-cleanup-failed':
    'The new profile could not be saved or cleared. Restart OpenWaggle before trying this import again.',
}

export const BROWSER_IMPORT_LIMITS = {
  SOURCE_PROFILES: 128,
  COOKIES: 50_000,
  SKIPPED_DOMAINS: 50,
  DATABASE_BYTES: 256 * 1_024 * 1_024,
  LOCAL_STATE_BYTES: 4 * 1_024 * 1_024,
  CREDENTIAL_OUTPUT_BYTES: 64 * 1_024,
  CREDENTIAL_HELPER_TIMEOUT_MS: 15_000,
  STRING_LENGTH: 8_192,
} as const
