import type { McpServerFactory, Transport } from '@modelcontextprotocol/server'
import { type StdioServerHandle, serveStdio } from '@modelcontextprotocol/server/stdio'

/**
 * Serve one capability factory to both current MCP clients and supported
 * pre-2026 clients. Centralising this option prevents an upstream default
 * change from silently dropping legacy interoperability.
 */
export function serveDualEraMcpStdio(
  factory: McpServerFactory,
  options: {
    readonly transport?: Transport
    readonly onerror?: (error: Error) => void
    readonly maxSubscriptions?: number
  } = {},
): StdioServerHandle {
  return serveStdio(factory, {
    legacy: 'serve',
    ...(options.transport ? { transport: options.transport } : {}),
    ...(options.onerror ? { onerror: options.onerror } : {}),
    ...(options.maxSubscriptions === undefined
      ? {}
      : { maxSubscriptions: options.maxSubscriptions }),
  })
}
