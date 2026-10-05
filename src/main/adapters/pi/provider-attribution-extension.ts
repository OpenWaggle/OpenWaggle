import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'

/**
 * OpenWaggle's provider attribution (ADR 0046, docs/specs/usage-statistics-fields.md).
 *
 * OpenWaggle's Pi settings report install telemetry as on, so Pi marks every request it can
 * attribute with its own labels (OpenRouter, NVIDIA NIM, Cloudflare). On each request this
 * extension then applies OpenWaggle's Usage statistics switch: while statistics are on, Pi's
 * labels become OpenWaggle's, and while they are off, Pi's labels are removed, so the request
 * carries what Pi sends with its own telemetry off.
 *
 * Only a header carrying Pi's exact attribution value changes. Authentication headers, headers a
 * user or provider configured, and opencode's `x-opencode-session` and `x-opencode-client`
 * headers are never touched.
 */

interface PiAttributionHeader {
  readonly name: string
  /** The value Pi's provider attribution sets. */
  readonly piValue: string
  /** The value sent while Usage statistics are on; `null` removes the header. */
  readonly openWaggleValue: string | null
}

export const OPENWAGGLE_PROVIDER_ATTRIBUTION = [
  // OpenRouter app attribution.
  { name: 'HTTP-Referer', piValue: 'https://pi.dev', openWaggleValue: 'https://openwaggle.ai' },
  { name: 'X-OpenRouter-Title', piValue: 'pi', openWaggleValue: 'OpenWaggle' },
  { name: 'X-OpenRouter-Categories', piValue: 'cli-agent', openWaggleValue: null },
  // NVIDIA NIM billing origin.
  { name: 'X-BILLING-INVOKE-ORIGIN', piValue: 'Pi', openWaggleValue: 'OpenWaggle' },
  // Cloudflare Workers AI and AI Gateway.
  { name: 'User-Agent', piValue: 'pi-coding-agent', openWaggleValue: 'OpenWaggle' },
] as const satisfies readonly PiAttributionHeader[]

type ProviderHeaders = Record<string, string | null>

function piAttribution(name: string, value: string | null) {
  const lowerName = name.toLowerCase()
  return OPENWAGGLE_PROVIDER_ATTRIBUTION.find(
    (header) => header.name.toLowerCase() === lowerName && header.piValue === value,
  )
}

/**
 * Rewrites Pi's attribution headers in place for one request. A removed header is deleted rather
 * than set to `null`, so a value the provider adapter sets underneath, such as Pi's runtime
 * `User-Agent`, still applies.
 */
export function applyOpenWaggleProviderAttribution(
  headers: ProviderHeaders,
  statisticsEnabled: boolean,
) {
  for (const name of Object.keys(headers)) {
    const attribution = piAttribution(name, headers[name] ?? null)
    if (!attribution) continue
    const value = statisticsEnabled ? attribution.openWaggleValue : null
    if (value === null) delete headers[name]
    else headers[name] = value
  }
}

/** First-party inline Pi extension applying OpenWaggle's provider attribution. */
export function createProviderAttributionExtension(
  isUsageStatisticsEnabled: () => boolean,
): ExtensionFactory {
  return (pi) => {
    pi.on('before_provider_headers', (event) => {
      applyOpenWaggleProviderAttribution(event.headers, isUsageStatisticsEnabled())
    })
  }
}
