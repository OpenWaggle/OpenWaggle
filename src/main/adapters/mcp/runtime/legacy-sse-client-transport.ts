import type { Transport } from '@modelcontextprotocol/client'

type LegacySseConstructor = new (url: URL, options: object) => Transport

function isLegacySseConstructor(value: unknown): value is LegacySseConstructor {
  return typeof value === 'function'
}

/**
 * Loads the SDK's deliberately retained SSE transport without binding the rest
 * of the runtime to a deprecated symbol. SSE remains part of OpenWaggle's
 * explicit compatibility contract for pre-Streamable-HTTP MCP servers.
 */
export async function createLegacySseClientTransport(url: URL, options: object) {
  const clientModule = await import('@modelcontextprotocol/client')
  const transportConstructor: unknown = Reflect.get(clientModule, 'SSEClientTransport')
  if (!isLegacySseConstructor(transportConstructor)) {
    throw new Error(
      'The installed MCP SDK does not provide its legacy SSE compatibility transport.',
    )
  }
  return new transportConstructor(url, options)
}
