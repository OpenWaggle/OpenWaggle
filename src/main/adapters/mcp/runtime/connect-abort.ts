import type { Client, Transport } from '@modelcontextprotocol/client'
import { MCP_CONFIG } from '@shared/constants/mcp'

/**
 * Connects a client, unless its slot is closed first.
 *
 * Closing a connection slot aborts its connect so the close does not wait for a slow server to
 * finish starting. Closing the client tears the transport down, which ends a stdio server's
 * process and makes the pending connect reject.
 */
export async function connectUnlessAborted(
  client: Client,
  transport: Transport,
  signal: AbortSignal | undefined,
) {
  const closeClient = () => client.close().catch(() => undefined)
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
