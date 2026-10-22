import type { ClientAttribution, ClientIdentity } from '@earendil-works/pi-ai'
import { setClientIdentityTransform } from '@earendil-works/pi-coding-agent'
import { isUsageStatisticsEnabled } from '../../usage-statistics/usage-statistics-enablement'

/**
 * OpenWaggle's provider attribution (ADR 0046, docs/specs/usage-statistics-fields.md).
 *
 * Pi labels the requests it can attribute (OpenRouter, NVIDIA NIM, opencode) from the client
 * identity of each request, gated by Pi's own install telemetry setting. OpenWaggle replaces that
 * attribution with its own on every Pi request: OpenWaggle's labels while Usage statistics are on,
 * none while they are off. Pi applies identity headers below model, provider, and request
 * headers, so headers a user or provider configured still win, and the `User-Agent` stays Pi's.
 */
export const OPENWAGGLE_PROVIDER_ATTRIBUTION = {
  name: 'OpenWaggle',
  url: 'https://openwaggle.ai',
} as const satisfies ClientAttribution

/**
 * The identity OpenWaggle sends instead of Pi's. Its attribution reads the statistics switch each
 * time a request is sent, so a request Pi repeats with an identity it kept, such as a cache
 * warming request, follows the switch too.
 */
export function openWaggleClientIdentity(
  piIdentity: ClientIdentity,
  isStatisticsEnabled: () => boolean,
): ClientIdentity {
  return {
    ...piIdentity,
    get attribution() {
      return isStatisticsEnabled() ? OPENWAGGLE_PROVIDER_ATTRIBUTION : null
    },
  }
}

/**
 * Installs OpenWaggle's attribution for every Pi request in this process, automation included.
 * Called at each Pi runtime construction chokepoint; repeats replace the same transform.
 */
export function installOpenWaggleProviderAttribution() {
  setClientIdentityTransform((piIdentity) =>
    openWaggleClientIdentity(piIdentity, isUsageStatisticsEnabled),
  )
}
