import type { Session } from 'electron'
import { session as electronSession } from 'electron'
import { browserPreviewPartition } from '../../browser-preview/browser-preview-partitions'
import { checkChromiumCacheSizeOnUse } from '../electron-chromium-disk-cache'

const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['clipboard-sanitized-write'])
const protectedSessions = new WeakSet<Session>()

export function browserPreviewWebPreferencesForProfile(profileId: string) {
  return {
    partition: browserPreviewPartition(profileId),
  } as const
}

export function installBrowserPreviewSessionPolicy(browserSession: Session) {
  // A preview partition caches whatever the user browses: 853 MB HTTP and 325 MB code cache seen.
  void checkChromiumCacheSizeOnUse(browserSession)
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
