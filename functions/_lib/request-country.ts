import type { IncomingRequest } from './cloudflare'
import { isRecord } from './http'

/** Cloudflare's code for an unknown country. Tor exits, which Cloudflare marks `T1`, map here. */
export const UNKNOWN_COUNTRY = 'XX'
const COUNTRY_CODE = /^[A-Z]{2}$/u

/**
 * The two-letter country Cloudflare resolved for the request. It is the only request metadata
 * the endpoint keeps; the address it was derived from is never read.
 */
export function requestCountry(request: IncomingRequest) {
  const metadata = request.cf
  if (!isRecord(metadata)) return UNKNOWN_COUNTRY
  const country = metadata.country
  return typeof country === 'string' && COUNTRY_CODE.test(country) ? country : UNKNOWN_COUNTRY
}
