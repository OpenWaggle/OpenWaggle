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
  mcpStartupWaitMs,
} from '../../mcp/pool/mcp-connection-pool-api'
import { createLogger } from '../../../logger'
import { hostPackageRunnerBypass } from '../../mcp/runtime/host-package-runner-bypass'
import type { StdioLaunch } from '../../mcp/runtime/mcp-package-runner-bypass'
import { createLegacySseClientTransport } from '../../mcp/runtime/legacy-sse-client-transport'
import { LegacyWebSocketClientTransport } from '../../mcp/runtime/websocket-transport'
import { createMcpAuthorizedFetch } from './mcp-authorized-fetch'
import { mcpAuthorizationServerUrls } from './mcp-sign-in-page'

const logger = createLogger('mcp-upstream')

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

/**
 * What a stdio server is spawned with before the package-runner bypass: as configured. Resolving
 * runs each `env` value's `!command` (Pi's `resolveConfigValueOrThrow`, synchronous), so it is done
 * once per spawn and the result passed on.
 */
function stdioLaunchInput(entry: McpServerEntry, cwd: string): StdioLaunch {
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
  return {
    command: expandHome(config.command),
    args: (config.args ?? []).map(expandHome),
    cwd: path.resolve(cwd, expandHome(config.cwd ?? '.')),
    // Pi gives servers the user's environment (the login shell's, for a Dock-launched app); the
    // packaged app's PATH also finds npx and uvx.
    env: stringEnv({ ...mcpValueEnvironment(), PATH: getNpmCompatiblePath(), ...env }),
  }
}

/** How long a server's first spawn waits for its package runner's bin to be resolved. */
export const MCP_PACKAGE_RUNNER_PREPARE_WAIT_MS = 30_000

function openStdio(configured: StdioLaunch, refreshPackage: boolean): McpUpstream {
  // A package runner (`npx`, `pnpm dlx`, `bunx`) is skipped once its bin is known (D1.2).
  const launch = hostPackageRunnerBypass().launch(configured, { refresh: refreshPackage })
  const transport = new StdioTransport({
    command: launch.command,
    ...(launch.args.length > 0 ? { args: [...launch.args] } : {}),
    cwd: launch.cwd,
    env: { ...launch.env },
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
    close: () => stopMcpProcessGroup(pid ?? transport.pid),
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
export async function stopMcpProcessGroup(pid: number | undefined) {
  if (pid === undefined || process.platform === 'win32') return
  if (!signalGroup(pid, 'SIGTERM')) return
  pendingKills.add(pid)
  setTimeout(() => {
    if (pendingKills.delete(pid)) signalGroup(pid, 'SIGKILL')
  }, GROUP_KILL_GRACE_MS).unref()
}

/** Groups sent SIGTERM whose SIGKILL is still due; the timer is unref'd, so exit would skip it. */
const pendingKills = new Set<number>()

function signalGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal)
    return true
  } catch {
    return false
  }
}

/**
 * At Host exit, after closing the pool: kills now every group still in its SIGTERM grace, so a
 * server that ignores SIGTERM does not outlive the Host.
 */
export function killPendingMcpProcessGroups() {
  for (const pid of pendingKills) signalGroup(pid, 'SIGKILL')
  pendingKills.clear()
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

interface OpenPiMcpUpstreamInput {
  readonly entry: McpServerEntry
  readonly transport: McpTransportKind
  readonly cwd: string
  readonly authProvider: AuthProvider | undefined
  /** Settings' check: launch through the package runner and resolve its bin again. */
  readonly refreshPackage?: boolean
}

/**
 * Opens the real connection to one server: pi-mcp's stdio transport (its own process group, so
 * closing it stops a package runner such as `npx` together with the server), streamable HTTP over
 * OpenWaggle's hardened fetch, or the legacy SSE and WebSocket transports.
 */
export function openPiMcpUpstream(input: OpenPiMcpUpstreamInput): McpUpstream {
  if (input.transport === 'stdio') {
    return openStdio(stdioLaunchInput(input.entry, input.cwd), input.refreshPackage === true)
  }
  return openHttp(input.entry, input.transport, input.authProvider)
}

/**
 * `openPiMcpUpstream` for a Session's connection: before a stdio server's spawn through a package
 * runner, its bin is resolved first (one probe per package for the whole Host, waiting a third of
 * the server's timeout, at most `MCP_PACKAGE_RUNNER_PREPARE_WAIT_MS`), so even the first spawn
 * skips the runner (D1.2). The
 * server's values are resolved once for both (review R5 P2-1): a `!command` value can be slow,
 * prompt, or mint a token.
 */
export async function openPreparedPiMcpUpstream(
  input: OpenPiMcpUpstreamInput & { readonly prepareWaitMs?: number },
): Promise<McpUpstream> {
  if (input.transport !== 'stdio') return openPiMcpUpstream(input)
  const launch = stdioLaunchInput(input.entry, input.cwd)
  try {
    await hostPackageRunnerBypass().prepare(
      launch,
      input.prepareWaitMs ??
        mcpStartupWaitMs(input.entry.config.timeout, MCP_PACKAGE_RUNNER_PREPARE_WAIT_MS),
    )
  } catch (error) {
    // The spawn below runs the command as configured and reports what is wrong with it.
    logger.warn('Could not prepare an MCP server launch; it starts as configured', {
      server: input.entry.name,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return openStdio(launch, input.refreshPackage === true)
}
