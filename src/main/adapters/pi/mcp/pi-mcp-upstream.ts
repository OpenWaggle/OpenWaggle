import { homedir } from 'node:os'
import path from 'node:path'
import {
  type McpServerEntry,
  resolveConfigValueOrThrow,
  resolveHeadersOrThrow,
} from '@earendil-works/pi-coding-agent'
import { type AuthProvider, StdioTransport, StreamableHttpTransport } from '@earendil-works/pi-mcp'
import type { McpTransportKind } from '../../../domain/mcp/config/mcp-server-config'
import { getEnvWithOverrides, getNpmCompatiblePath } from '../../../env'
import type { McpUpstream } from '../../mcp/pool/mcp-connection-support'
import { DeferredTransport } from '../../mcp/pool/mcp-deferred-transport'
import { McpSdkTransportAdapter } from '../../mcp/pool/mcp-sdk-transport-adapter'
import { createMcpServerFetch, MCP_MAX_MESSAGE_BYTES } from '../../mcp/pool/mcp-server-fetch'
import { createLegacySseClientTransport } from '../../mcp/runtime/legacy-sse-client-transport'
import { LegacyWebSocketClientTransport } from '../../mcp/runtime/websocket-transport'
import { createMcpAuthorizedFetch } from './mcp-authorized-fetch'

/** Characters of a failed stdio server's stderr shown with its error, as in Pi. */
const STDERR_TAIL_CHARS = 2_000

const HOME_PREFIX_LENGTH = '~/'.length

/** `~` and `~/…` name the home directory, as in Pi and a shell. */
function expandHome(value: string) {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || (process.platform === 'win32' && value.startsWith('~\\'))) {
    return path.join(homedir(), value.slice(HOME_PREFIX_LENGTH))
  }
  return value
}

function stringEnv(values: Readonly<Record<string, string | undefined>>) {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
}

function openStdio(entry: McpServerEntry, cwd: string): McpUpstream {
  if (!('command' in entry.config)) throw new Error(`MCP server "${entry.name}" has no command`)
  const { config } = entry
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(config.env ?? {})) {
    env[key] = resolveConfigValueOrThrow(value, `MCP server "${entry.name}" env "${key}"`)
  }
  const transport = new StdioTransport({
    command: expandHome(config.command),
    ...(config.args ? { args: config.args.map(expandHome) } : {}),
    cwd: path.resolve(cwd, expandHome(config.cwd ?? '.')),
    // Pi gives servers the user's environment; the packaged app's PATH also finds npx and uvx.
    env: stringEnv(getEnvWithOverrides({ PATH: getNpmCompatiblePath(), ...env })),
    inheritEnv: false,
    stderr: 'pipe',
  })
  return { transport, stderrTail: () => transport.stderr.trim().slice(-STDERR_TAIL_CHARS) }
}

function urlOf(entry: McpServerEntry) {
  if (!('url' in entry.config)) throw new Error(`MCP server "${entry.name}" has no url`)
  return entry.config
}

function openSse(
  config: { readonly url: string },
  headers: Record<string, string>,
  authProvider: AuthProvider | undefined,
): McpUpstream {
  const fetch = createMcpServerFetch(config.url)
  const authorized = authProvider
    ? createMcpAuthorizedFetch({ fetch, authProvider, serverUrl: new URL(config.url) })
    : undefined
  const sseFetch = authorized ?? fetch
  return {
    transport: new DeferredTransport(
      async () => {
        const sdk = await createLegacySseClientTransport(new URL(config.url), {
          fetch: sseFetch,
          requestInit: { headers },
          eventSourceInit: { fetch: sseFetch },
        })
        return new McpSdkTransportAdapter(sdk)
      },
      () => authorized?.authFailure(),
    ),
    close: () => fetch.close(),
  }
}

function openHttp(
  entry: McpServerEntry,
  kind: McpTransportKind,
  authProvider: AuthProvider | undefined,
): McpUpstream {
  const config = urlOf(entry)
  const headers = resolveHeadersOrThrow(config.headers, `MCP server "${entry.name}"`) ?? {}
  if (kind === 'websocket') {
    return {
      transport: new McpSdkTransportAdapter(
        // The configured server may be plain ws:// or on a private network, as HTTP servers may.
        new LegacyWebSocketClientTransport({
          url: new URL(config.url),
          headers,
          allowInsecurePrivateNetwork: true,
          allowPlainWebSocket: true,
        }),
      ),
    }
  }
  if (kind === 'sse') return openSse(config, headers, authProvider)
  const fetch = createMcpServerFetch(config.url)
  return {
    transport: new StreamableHttpTransport({
      url: config.url,
      headers,
      fetch,
      maxMessageBytes: MCP_MAX_MESSAGE_BYTES,
      ...(authProvider ? { authProvider } : {}),
    }),
    close: () => fetch.close(),
  }
}

/**
 * Opens the real connection to one server: pi-mcp's stdio transport (its own process group, so
 * closing it stops a package runner such as `npx` together with the server), streamable HTTP over
 * OpenWaggle's hardened fetch, or the legacy SSE and WebSocket transports.
 */
export function openPiMcpUpstream(input: {
  readonly entry: McpServerEntry
  readonly transport: McpTransportKind
  readonly cwd: string
  readonly authProvider: AuthProvider | undefined
}): McpUpstream {
  if (input.transport === 'stdio') return openStdio(input.entry, input.cwd)
  return openHttp(input.entry, input.transport, input.authProvider)
}
