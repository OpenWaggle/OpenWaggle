import { McpServer } from '@modelcontextprotocol/server'
import { MCP_LEGACY_PROTOCOL_VERSIONS, MCP_MODERN_PROTOCOL_VERSIONS } from '@shared/constants/mcp'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import { z } from 'zod'
import { serveDualEraMcpLoopbackHttp } from './mcp-server-http'
import { serveDualEraMcpStdio } from './mcp-server-stdio'
import type { OpenWaggleMcpServeOptions } from './openwaggle-mcp-server-policy'
import { registerOpenWaggleSessionToolV2 } from './openwaggle-mcp-session-tool-v2'

export {
  OPENWAGGLE_MCP_SERVE_GRANTS,
  type OpenWaggleMcpServeGrant,
  type OpenWaggleMcpServeOptions,
} from './openwaggle-mcp-server-policy'

const CATALOG_CACHE_TTL_MS = 60_000
const RESOURCE_LIST_CACHE_TTL_MS = 10_000
const MAX_SERVER_SUBSCRIPTIONS = 128

function registerServerResources(server: McpServer, options: OpenWaggleMcpServeOptions) {
  server.registerResource(
    'OpenWaggle caller capabilities',
    'openwaggle://caller/capabilities',
    {
      title: 'OpenWaggle MCP caller capabilities',
      description: 'The exact grants and constraints applied to this MCP server process.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify({
            profile: options.profile,
            grants: [...options.grants].sort(),
            workspaceRoots: options.workspaceRoots,
            exportRoots: options.exportRoots ?? [],
            attachmentRoots: options.attachmentRoots ?? [],
            sessionIds: [...options.sessionIds].sort(),
            ...(options.originSessionId ? { originSessionId: options.originSessionId } : {}),
            transports: [options.transport],
            sessionContractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            protocolCompatibility: {
              modern: MCP_MODERN_PROTOCOL_VERSIONS,
              legacy: MCP_LEGACY_PROTOCOL_VERSIONS,
            },
          }),
        },
      ],
    }),
  )
}

function registerServerPrompt(server: McpServer) {
  server.registerPrompt(
    'delegate-openwaggle-task',
    {
      title: 'Delegate a task to OpenWaggle',
      description: 'Prepare a durable Session or Hive Worker request for Session Control v2.',
      argsSchema: z.object({ objective: z.string(), projectPath: z.string() }),
    },
    ({ objective, projectPath }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Use openwaggle_sessions with operation="launch", projectPath=${JSON.stringify(projectPath)}, and this objective. If delegating from an active Session, use operation="spawn" with its exact Session and Run IDs instead:\n\n${objective}`,
          },
        },
      ],
    }),
  )
}

function createOpenWaggleMcpServer(options: OpenWaggleMcpServeOptions) {
  const server = new McpServer(
    { name: 'OpenWaggle', version: options.version },
    {
      instructions:
        'Use openwaggle_sessions for durable Session and Hive orchestration through Session Control v2. Follow-ups remain queued for the next Run; Steering targets one exact active Run. Raw shell and transparent upstream MCP passthrough are intentionally unavailable.',
      cacheHints: {
        'tools/list': { ttlMs: CATALOG_CACHE_TTL_MS, cacheScope: 'private' },
        'prompts/list': { ttlMs: CATALOG_CACHE_TTL_MS, cacheScope: 'private' },
        'resources/list': { ttlMs: RESOURCE_LIST_CACHE_TTL_MS, cacheScope: 'private' },
        'resources/read': { ttlMs: 0, cacheScope: 'private' },
        'server/discover': { ttlMs: CATALOG_CACHE_TTL_MS, cacheScope: 'private' },
      },
    },
  )
  registerServerResources(server, options)
  registerServerPrompt(server)
  registerOpenWaggleSessionToolV2(server, options, {
    userDataRoot: options.userDataRoot,
    version: options.version,
  })
  return server
}

export async function serveOpenWaggleMcpServer(options: OpenWaggleMcpServeOptions) {
  const factory = () => createOpenWaggleMcpServer(options)
  const reportError = (error: Error) =>
    options.stderr?.write(`OpenWaggle MCP server error: ${error.message}\n`)
  if (options.transport === 'streamable-http') {
    if (options.httpPort === undefined || !options.bearerToken) {
      throw new Error('Loopback Streamable HTTP requires a port and bearer token.')
    }
    const handle = await serveDualEraMcpLoopbackHttp({
      factory,
      port: options.httpPort,
      bearerToken: options.bearerToken,
      maxSubscriptions: MAX_SERVER_SUBSCRIPTIONS,
      onerror: reportError,
    })
    options.stderr?.write(`OpenWaggle MCP listening at ${handle.url}\n`)
    const close = async () => {
      await handle.close().catch(() => undefined)
    }
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve)
      process.once('SIGTERM', resolve)
    }).finally(close)
    return
  }
  const handle = serveDualEraMcpStdio(factory, {
    maxSubscriptions: MAX_SERVER_SUBSCRIPTIONS,
    onerror: reportError,
  })
  const close = async () => {
    await handle.close().catch(() => undefined)
  }
  await new Promise<void>((resolve, reject) => {
    process.stdin.once('end', resolve)
    process.stdin.once('close', resolve)
    process.stdin.once('error', reject)
  }).finally(close)
}
