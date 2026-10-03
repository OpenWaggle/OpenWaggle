/**
 * The website beacon contract: what openwaggle.ai pages send to `/api/v1/web`, described in
 * the Website section of docs/specs/usage-statistics-fields.md. The endpoint and the site's
 * tracking script both import it, so it stays dependency-free.
 */

export const WEB_BEACON_PATH = '/api/v1/web'
export const WEB_PRODUCTION_HOSTNAME = 'openwaggle.ai'

export const WEB_BEACON_TYPES = ['pageview', 'download_click'] as const
export type WebBeaconType = (typeof WEB_BEACON_TYPES)[number]

/** What a tracked download link points at; the link itself is never sent. */
export const WEB_DOWNLOAD_TARGETS = [
  'github_releases',
  'release_asset',
  'install_script',
  'installation_page',
] as const
export type WebDownloadTarget = (typeof WEB_DOWNLOAD_TARGETS)[number]

export const WEB_UTM_PARAMETERS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const
export type WebUtmParameter = (typeof WEB_UTM_PARAMETERS)[number]

export const WEB_BEACON_MAX_BYTES = 4096
export const WEB_BEACON_MAX_PATH_LENGTH = 512
export const WEB_BEACON_MAX_REFERRER_LENGTH = 1024
export const WEB_BEACON_MAX_UTM_LENGTH = 128

export type WebBeaconUtm = { readonly [Parameter in WebUtmParameter]?: string }

interface WebBeaconPage extends WebBeaconUtm {
  /** Page path, without query or fragment. */
  readonly path: string
  /** Origin of the referring page, without its path; empty when there is none. */
  readonly referrer: string
}

export type WebBeacon =
  | (WebBeaconPage & { readonly type: 'pageview' })
  | (WebBeaconPage & { readonly type: 'download_click'; readonly target: WebDownloadTarget })
