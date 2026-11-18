/** Host and protocol rules shared by MCP network connections and sign-in pages. */

export function isLoopbackMcpHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function normalizedAllowedHostname(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    if (!['https:', 'wss:', 'http:', 'ws:'].includes(url.protocol)) return null
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
    return url.hostname.toLowerCase()
  } catch {
    return null
  }
}

export function normalizeMcpAllowedHosts(values: readonly string[]) {
  return new Set(
    values
      .map(normalizedAllowedHostname)
      .filter((hostname): hostname is string => hostname !== null),
  )
}

export function isAllowedMcpHostname(allowedHosts: ReadonlySet<string>, hostname: string) {
  const normalized = hostname.toLowerCase()
  if (allowedHosts.has(normalized)) return true
  for (const allowed of allowedHosts) {
    if (allowed.startsWith('*.') && normalized.endsWith(allowed.slice(1))) return true
  }
  return false
}

export function assertSecureMcpProtocol(url: URL, websocket: boolean) {
  const secureProtocol = websocket ? 'wss:' : 'https:'
  if (url.protocol === secureProtocol) return
  const loopbackProtocol = websocket ? 'ws:' : 'http:'
  if (url.protocol === loopbackProtocol && isLoopbackMcpHostname(url.hostname)) return
  throw new Error(
    `MCP network connections require ${secureProtocol} except for explicit loopback URLs.`,
  )
}
