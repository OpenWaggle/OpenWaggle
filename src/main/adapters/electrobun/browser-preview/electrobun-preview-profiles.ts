import { safeDecodeUnknown, Schema } from '@shared/schema'
import type { CdpSocketFactory } from './cdp-connection'
import type { CefDevToolsEndpoint } from './cef-devtools-endpoint'
import { browserPreviewMarkerUrl, newBrowserPreviewMarker } from './electrobun-preview-cdp-protocol'
import { ElectrobunPreviewGuest, type ElectrobunPreviewView } from './electrobun-preview-guest'
import { browserPreviewPartition } from '../../browser-preview/browser-preview-partitions'
import type { ImportedBrowserCookie } from '../../../browser-import/browser-cookie-model'
import type { BrowserProfileCookieJar } from '../../../ports/desktop-shell/browser-preview-views'

const IDLE_CLOSE_MS = 30_000

const SetCookieResultSchema = Schema.Struct({ success: Schema.optional(Schema.Boolean) })
const AllCookiesSchema = Schema.Struct({
  cookies: Schema.Array(Schema.Struct({ domain: Schema.String })),
})

interface ProfileMaintenanceHost {
  readonly createView: (options: {
    readonly windowId: number
    readonly url: string
    readonly partition: string
  }) => ElectrobunPreviewView
  readonly maintenanceWindowId: () => number
  readonly endpoint: () => CefDevToolsEndpoint | null
  readonly openSocket: CdpSocketFactory
}

const SAME_SITE: Record<ImportedBrowserCookie['sameSite'], string | undefined> = {
  unspecified: undefined,
  no_restriction: 'None',
  lax: 'Lax',
  strict: 'Strict',
}

/** `Network.setCookie` parameters for an imported cookie; a host-only cookie names no domain. */
export function cdpCookieParams(cookie: ImportedBrowserCookie) {
  const sameSite = SAME_SITE[cookie.sameSite]
  return {
    url: cookie.url,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    ...(cookie.domain === undefined ? {} : { domain: cookie.domain }),
    ...(cookie.expirationDate === undefined ? {} : { expires: cookie.expirationDate }),
    ...(sameSite === undefined ? {} : { sameSite }),
  }
}

function originsOfCookieDomains(domains: readonly string[]) {
  const hosts = new Set(
    domains.map((domain) => (domain.startsWith('.') ? domain.slice(1) : domain)),
  )
  return [...hosts].flatMap((host) => [`https://${host}`, `http://${host}`])
}

/**
 * A Browser profile's site data on Electrobun. Electrobun's `Session` API reaches the system
 * webview's stores (WKWebsiteDataStore, WebKitGTK, WebView2), never CEF's, so CEF profiles are
 * reached over CDP through a blank page in the profile's partition, in a hidden window. The page
 * closes after a short idle time.
 */
export class ElectrobunPreviewProfiles {
  private readonly pages = new Map<string, Promise<ElectrobunPreviewGuest>>()
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>()

  private readonly host: ProfileMaintenanceHost

  constructor(host: ProfileMaintenanceHost) {
    this.host = host
  }

  cookieJar(profileId: string): BrowserProfileCookieJar {
    return {
      cookies: {
        set: async (cookie) => {
          const result = await this.send(profileId, 'Network.setCookie', cdpCookieParams(cookie))
          const decoded = safeDecodeUnknown(SetCookieResultSchema, result)
          if (decoded.success && decoded.data.success === false) {
            throw new Error(`The browser profile refused the cookie "${cookie.name}".`)
          }
        },
        // CEF writes its cookie store itself; flushing releases the maintenance page.
        flushStore: async () => this.release(profileId),
      },
    }
  }

  /** Deletes the profile's cookies and HTTP cache, and the site storage of every cookie origin. */
  async clearProfileData(profileId: string): Promise<void> {
    const all = safeDecodeUnknown(
      AllCookiesSchema,
      await this.send(profileId, 'Network.getAllCookies'),
    )
    const origins = all.success ? originsOfCookieDomains(all.data.cookies.map((c) => c.domain)) : []
    await this.send(profileId, 'Network.clearBrowserCookies')
    await this.send(profileId, 'Network.clearBrowserCache')
    for (const origin of origins) {
      await this.send(profileId, 'Storage.clearDataForOrigin', { origin, storageTypes: 'all' })
    }
    await this.release(profileId)
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.pages.keys()].map((profileId) => this.release(profileId)))
  }

  private async send(profileId: string, method: string, params: object = {}) {
    const page = await this.page(profileId)
    this.touch(profileId)
    return page.send(method, params)
  }

  private page(profileId: string): Promise<ElectrobunPreviewGuest> {
    const existing = this.pages.get(profileId)
    if (existing) return existing
    const marker = newBrowserPreviewMarker()
    const view = this.host.createView({
      windowId: this.host.maintenanceWindowId(),
      url: browserPreviewMarkerUrl(marker),
      partition: browserPreviewPartition(profileId),
    })
    const guest = new ElectrobunPreviewGuest({
      view,
      marker,
      endpoint: this.host.endpoint(),
      openSocket: this.host.openSocket,
      onEvent: () => undefined,
    })
    const ready = guest
      .attachOnly({ chords: [], muted: true, isMac: false })
      .then(() => guest)
      .catch((error: unknown) => {
        this.pages.delete(profileId)
        guest.close()
        throw error
      })
    this.pages.set(profileId, ready)
    return ready
  }

  private touch(profileId: string) {
    clearTimeout(this.idleTimers.get(profileId))
    const timer = setTimeout(() => void this.release(profileId), IDLE_CLOSE_MS)
    timer.unref()
    this.idleTimers.set(profileId, timer)
  }

  private async release(profileId: string) {
    clearTimeout(this.idleTimers.get(profileId))
    this.idleTimers.delete(profileId)
    const page = this.pages.get(profileId)
    if (page === undefined) return
    this.pages.delete(profileId)
    const guest = await page.catch(() => null)
    guest?.close()
  }
}
