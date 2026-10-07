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
import { McpSdkTransportAdapter } from '../../mcp/pool/mcp-sdk-transport-adapter'
import { createMcpServerFetch, MCP_MAX_MESSAGE_BYTES } from '../../mcp/pool/mcp-server-fetch'
import {
  type JsonRpcMessage,
  type McpWireTransport,
  WireTransportEvents,
} from '../../mcp/pool/mcp-wire'
import { createLegacySseClientTransport } from '../../mcp/runtime/legacy-sse-client-transport'
import { LegacyWebSocketClientTransport } from '../../mcp/runtime/websocket-transport'

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

/** A transport created when it starts, for the SDK transports that load asynchronously. */
class DeferredTransport extends WireTransportEvents implements McpWireTransport {
  private inner: McpWireTransport | undefined
  private protocolVersion: string | undefined

  constructor(private readonly create: () => Promise<McpWireTransport>) {
    super()
  }

  async start() {
    const inner = await this.create()
    this.inner = inner
    inner.onMessage((message) => this.emitMessage(message))
    inner.onError((error) => this.emitError(error))
    inner.onClose(() => this.emitClose())
    if (this.protocolVersion) inner.setProtocolVersion?.(this.protocolVersion)
    await inner.start()
  }

  send(message: JsonRpcMessage) {
    if (!this.inner) return Promise.reject(new Error('MCP transport is not started'))
    return this.inner.send(message)
  }

  async close() {
    if (this.inner) await this.inner.close()
    this.emitClose()
  }

  setProtocolVersion(version: string) {
    this.protocolVersion = version
    this.inner?.setProtocolVersion?.(version)
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
        new LegacyWebSocketClientTransport({ url: new URL(config.url), headers }),
      ),
    }
  }
  const fetch = createMcpServerFetch(config.url)
  if (kind === 'sse') {
    return {
      transport: new DeferredTransport(async () => {
        const sdk = await createLegacySseClientTransport(new URL(config.url), {
          fetch,
          requestInit: { headers },
          eventSourceInit: { fetch },
        })
        return new McpSdkTransportAdapter(sdk)
      }),
    }
  }
  return {
    transport: new StreamableHttpTransport({
      url: config.url,
      headers,
      fetch,
      maxMessageBytes: MCP_MAX_MESSAGE_BYTES,
      ...(authProvider ? { authProvider } : {}),
    }),
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
