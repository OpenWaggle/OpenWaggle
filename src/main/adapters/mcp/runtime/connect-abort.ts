import type { Client, Transport } from '@modelcontextprotocol/client'
import { MCP_CONFIG } from '@shared/constants/mcp'

/**
 * Connects a client, unless its slot is closed first.
 *
 * Closing a connection slot aborts its connect so the close does not wait for a slow server to
 * finish starting. The transport is closed as well as the client: while the SDK probes the
 * protocol version it has not attached the transport to the client yet, so closing the client
 * alone would do nothing. Closing the transport ends a stdio server's process and makes the
 * pending connect reject.
 */
export async function connectUnlessAborted(
  client: Client,
  transport: Transport,
  signal: AbortSignal | undefined,
) {
  const closeClient = () =>
    Promise.all([transport.close().catch(() => undefined), client.close().catch(() => undefined)])
  if (signal?.aborted) {
    await transport.close().catch(() => undefined)
    throw new Error('MCP connection was cancelled before it started.')
  }
  signal?.addEventListener('abort', closeClient, { once: true })
  try {
    await client.connect(transport, {
      timeout: MCP_CONFIG.CONNECT_TIMEOUT_MS,
      maxTotalTimeout: MCP_CONFIG.CONNECT_TIMEOUT_MS,
    })
    if (signal?.aborted) throw new Error('MCP connection was cancelled while it started.')
  } catch (error) {
    await closeClient()
    throw error
  } finally {
    signal?.removeEventListener('abort', closeClient)
  }
}
