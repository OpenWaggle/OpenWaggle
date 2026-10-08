import { homedir } from 'node:os'
import path from 'node:path'
import {
  type McpServerEntry,
  resolveConfigValueOrThrow,
  resolveHeadersOrThrow,
} from '@earendil-works/pi-coding-agent'
import { type AuthProvider, StdioTransport, StreamableHttpTransport } from '@earendil-works/pi-mcp'
import type { McpTransportKind } from '../../../domain/mcp/config/mcp-server-config'
import { getNpmCompatiblePath } from '../../../env'
import { mcpValueEnvironment } from '../../../mcp-shell-environment'
import {
  createMcpServerFetch,
  DeferredTransport,
  MCP_MAX_MESSAGE_BYTES,
  McpSdkTransportAdapter,
  type McpUpstream,
} from '../../mcp/pool/mcp-connection-pool-api'
import { createLegacySseClientTransport } from '../../mcp/runtime/legacy-sse-client-transport'
import { LegacyWebSocketClientTransport } from '../../mcp/runtime/websocket-transport'
import { createMcpAuthorizedFetch } from './mcp-authorized-fetch'
import { mcpAuthorizationServerUrls } from './mcp-sign-in-page'

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
    env[key] = resolveConfigValueOrThrow(
      value,
      `MCP server "${entry.name}" env "${key}"`,
      mcpValueEnvironment(),
    )
  }
  const transport = new StdioTransport({
    command: expandHome(config.command),
    ...(config.args ? { args: config.args.map(expandHome) } : {}),
    cwd: path.resolve(cwd, expandHome(config.cwd ?? '.')),
    // Pi gives servers the user's environment (the login shell's, for a Dock-launched app); the
    // packaged app's PATH also finds npx and uvx.
    env: stringEnv({ ...mcpValueEnvironment(), PATH: getNpmCompatiblePath(), ...env }),
    inheritEnv: false,
    stderr: 'pipe',
  })
  // pi-mcp forgets the process once its pipes close, which can be before this connection closes;
  // the group is stopped by the pid the server started with.
  let pid: number | undefined
  const start = transport.start.bind(transport)
  transport.start = async () => {
    await start()
    pid = transport.pid
  }
  return {
    transport,
    stderrTail: () => transport.stderr.trim().slice(-STDERR_TAIL_CHARS),
    close: () => stopProcessGroup(pid ?? transport.pid),
  }
}

/** Time the rest of a process group gets after SIGTERM before SIGKILL, as in pi-mcp. */
const GROUP_KILL_GRACE_MS = 2_000

/**
 * pi-mcp's `close()` returns early when the process it started has already exited, so a server a
 * launcher left running in the group would survive. After the transport closes, the whole group
 * is stopped anyway. POSIX only: Windows has no process groups, and pi-mcp's `taskkill /T` covers
 * the tree while the launcher is alive.
 */
async function stopProcessGroup(pid: number | undefined) {
  if (pid === undefined || process.platform === 'win32') return
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal)
      return true
    } catch {
      return false
    }
  }
  if (!signalGroup('SIGTERM')) return
  setTimeout(() => signalGroup('SIGKILL'), GROUP_KILL_GRACE_MS).unref()
}

function urlOf(entry: McpServerEntry) {
  if (!('url' in entry.config)) throw new Error(`MCP server "${entry.name}" has no url`)
  return entry.config
}

/** The fetch of a URL server, which may also reach the server's own authorization servers. */
function serverFetch(entry: McpServerEntry, url: string) {
  return createMcpServerFetch(url, {
    authorizationServers: () => mcpAuthorizationServerUrls(entry),
  })
}

function openSse(
  entry: McpServerEntry,
  config: { readonly url: string },
  headers: Record<string, string>,
  authProvider: AuthProvider | undefined,
): McpUpstream {
  const fetch = serverFetch(entry, config.url)
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
  const headers =
    resolveHeadersOrThrow(config.headers, `MCP server "${entry.name}"`, mcpValueEnvironment()) ?? {}
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
  if (kind === 'sse') return openSse(entry, config, headers, authProvider)
  const fetch = serverFetch(entry, config.url)
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
