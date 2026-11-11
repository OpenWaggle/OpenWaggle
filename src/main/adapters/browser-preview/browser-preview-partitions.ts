import { createHash } from 'node:crypto'
import {
  DEFAULT_BROWSER_PROFILE_ID,
  INCOGNITO_BROWSER_PROFILE_ID,
} from '@shared/types/browser-profile'

const LEGACY_DEFAULT_PARTITION = 'persist:openwaggle-browser-preview'
const PERSISTENT_PROFILE_PREFIX = 'persist:openwaggle-browser-preview-profile-'
const INCOGNITO_PARTITION = 'openwaggle-browser-preview-incognito'
const PARTITION_HASH_LENGTH = 20
const HEX_RADIX = 16
const UNICODE_ESCAPE_WIDTH = 4

function scopeBytes(profileId: string) {
  const escaped = profileId
    .replace(/\\/g, '\\\\')
    .replace(
      /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,
      (unit) => `\\u${unit.charCodeAt(0).toString(HEX_RADIX).padStart(UNICODE_ESCAPE_WIDTH, '0')}`,
    )
  return new TextEncoder().encode(escaped)
}

/**
 * A Browser profile's partition name. The same names on every shell: `persist:*` profiles keep
 * their site data on disk, the Incognito partition is in memory.
 */
export function browserPreviewPartition(profileId: string) {
  if (profileId === DEFAULT_BROWSER_PROFILE_ID) return LEGACY_DEFAULT_PARTITION
  if (profileId === INCOGNITO_BROWSER_PROFILE_ID) return INCOGNITO_PARTITION
  const digest = createHash('sha256').update(scopeBytes(profileId)).digest('hex')
  return `${PERSISTENT_PROFILE_PREFIX}${digest.slice(0, PARTITION_HASH_LENGTH)}`
}

export function isBrowserPreviewPartition(partition: string) {
  return (
    partition === LEGACY_DEFAULT_PARTITION ||
    partition === INCOGNITO_PARTITION ||
    partition.startsWith(PERSISTENT_PROFILE_PREFIX)
  )
}
