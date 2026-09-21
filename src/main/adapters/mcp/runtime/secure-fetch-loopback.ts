import { isIP } from 'node:net'

const IP_FAMILY_V4 = 4
const IP_FAMILY_V6 = 6

export function isLoopbackAddress(address: string) {
  const normalized = address.toLowerCase().split('%')[0] ?? ''
  if (isIP(normalized) === IP_FAMILY_V4) return normalized.startsWith('127.')
  if (isIP(normalized) === IP_FAMILY_V6) {
    return normalized === '::1' || normalized.startsWith('::ffff:127.')
  }
  return false
}

export function assertResolvedLoopbackAllowed(
  hostname: string,
  addresses: readonly { readonly address: string }[],
  allowLoopback: boolean | undefined,
) {
  if (allowLoopback === false && addresses.some(({ address }) => isLoopbackAddress(address))) {
    throw new Error(`MCP hostname resolves to forbidden loopback: ${hostname}.`)
  }
}
