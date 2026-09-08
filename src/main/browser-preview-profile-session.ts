import { createHash } from 'node:crypto'
import {
  DEFAULT_BROWSER_PROFILE_ID,
  INCOGNITO_BROWSER_PROFILE_ID,
} from '@shared/types/browser-profile'
import type { Session } from 'electron'
import { session as electronSession } from 'electron'

const LEGACY_DEFAULT_PARTITION = 'persist:openwaggle-browser-preview'
const PERSISTENT_PROFILE_PREFIX = 'persist:openwaggle-browser-preview-profile-'
const INCOGNITO_PARTITION = 'openwaggle-browser-preview-incognito'
const PARTITION_HASH_LENGTH = 20
const HEX_RADIX = 16
const UNICODE_ESCAPE_WIDTH = 4

const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write'])
const protectedSessions = new WeakSet<Session>()

function scopeBytes(profileId: string) {
  const escaped = profileId
    .replace(/\\/g, '\\\\')
    .replace(
      /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,
      (unit) => `\\u${unit.charCodeAt(0).toString(HEX_RADIX).padStart(UNICODE_ESCAPE_WIDTH, '0')}`,
    )
  return new TextEncoder().encode(escaped)
}

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

export function browserPreviewWebPreferencesForProfile(profileId: string) {
  return {
    partition: browserPreviewPartition(profileId),
  } as const
}

export function installBrowserPreviewSessionPolicy(browserSession: Session) {
  if (protectedSessions.has(browserSession)) return

  browserSession.setPermissionCheckHandler((_contents, permission) =>
    ALLOWED_PERMISSIONS.has(permission),
  )
  browserSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission))
  })
  browserSession.setDevicePermissionHandler(() => false)
  browserSession.setDisplayMediaRequestHandler((_request, callback) => callback({}))
  browserSession.setBluetoothPairingHandler((_details, callback) => callback({ confirmed: false }))
  browserSession.on('will-download', (event) => event.preventDefault())
  browserSession.on('select-hid-device', (event, _details, callback) => {
    event.preventDefault()
    callback()
  })
  browserSession.on('select-serial-port', (event, _ports, _contents, callback) => {
    event.preventDefault()
    callback('')
  })
  browserSession.on('select-usb-device', (event, _details, callback) => {
    event.preventDefault()
    callback()
  })

  const userAgent = browserSession
    .getUserAgent()
    .replace(/Electron\/[\d.]+\s*/u, '')
    .replace(/\s*OpenWaggle\/[\d.]+/u, '')
    .replace(/\s+/gu, ' ')
    .trim()
  browserSession.setUserAgent(userAgent)
  protectedSessions.add(browserSession)
}

export function browserPreviewSessionForProfile(
  profileId: string,
  sessions: Pick<typeof electronSession, 'fromPartition'> = electronSession,
) {
  const browserSession = sessions.fromPartition(browserPreviewPartition(profileId))
  installBrowserPreviewSessionPolicy(browserSession)
  return browserSession
}

export async function clearBrowserPreviewProfileData(
  profileId: string,
  sessions: Pick<typeof electronSession, 'fromPartition'> = electronSession,
) {
  const browserSession = browserPreviewSessionForProfile(profileId, sessions)
  await Promise.all([browserSession.clearStorageData(), browserSession.clearCache()])
}
