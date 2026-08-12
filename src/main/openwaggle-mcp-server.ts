import { McpServer } from '@modelcontextprotocol/server'
import {
  MCP_CONFIG,
  MCP_LEGACY_PROTOCOL_VERSIONS,
  MCP_MODERN_PROTOCOL_VERSIONS,
} from '@shared/constants/mcp'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { z } from 'zod'
import { serveDualEraMcpLoopbackHttp } from './mcp-server-http'
import { serveDualEraMcpStdio } from './mcp-server-stdio'
import type { OpenWaggleMcpServeOptions } from './openwaggle-mcp-server-policy'
import {
  OpenWaggleMcpSessionMetadataStore,
  sessionMetadataStorePath,
} from './openwaggle-mcp-session-metadata-store'
import { registerOpenWaggleSessionTool } from './openwaggle-mcp-session-tool'
import {
  materializeHostedSessionWorktree,
  removeHostedSessionWorktree,
} from './openwaggle-mcp-session-worktree'
import { OpenWaggleServerTaskManager } from './openwaggle-mcp-task-manager'
import { registerOpenWaggleTaskTool } from './openwaggle-mcp-task-tool'
import { SessionProjectionRepository } from './ports/session-projection-repository'
import { disposeAppRuntime, initializeAppRuntime, runAppEffect } from './runtime'

export {
  OPENWAGGLE_MCP_SERVE_GRANTS,
  type OpenWaggleMcpServeGrant,
  type OpenWaggleMcpServeOptions,
} from './openwaggle-mcp-server-policy'

const CATALOG_CACHE_TTL_MS = 60_000
const RESOURCE_LIST_CACHE_TTL_MS = 10_000
const MAX_SERVER_SUBSCRIPTIONS = 128

function registerServerResources(
  server: McpServer,
  options: OpenWaggleMcpServeOptions,
  tasks: OpenWaggleServerTaskManager,
  sessionMetadata: OpenWaggleMcpSessionMetadataStore,
) {
  server.registerResource(
    'OpenWaggle caller capabilities',
    'openwaggle://caller/capabilities',
    {
      title: 'OpenWaggle MCP caller capabilities',
      description: 'The exact grants and constraints applied to this MCP server process.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const originDepth = await sessionMetadata.depth(options.originSessionId)
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({
              profile: options.profile,
              grants: [...options.grants].sort(),
              workspaceRoots: options.workspaceRoots,
              sessionIds: [...options.sessionIds].sort(),
              originDepth,
              maxDepth: MCP_CONFIG.MAX_ORCHESTRATION_DEPTH,
              maxFanOut: MCP_CONFIG.MAX_SESSION_FAN_OUT,
              ...(options.originSessionId ? { originSessionId: options.originSessionId } : {}),
              transports: [options.transport],
              protocolCompatibility: {
                modern: MCP_MODERN_PROTOCOL_VERSIONS,
                legacy: MCP_LEGACY_PROTOCOL_VERSIONS,
              },
            }),
          },
        ],
      }
    },
  )
  server.registerResource(
    'OpenWaggle task index',
    'openwaggle://tasks',
    {
      title: 'Durable OpenWaggle tasks',
      description: 'Task status and result metadata for this caller profile.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(await runAppEffect(tasks.list())),
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
      description: 'Prepare a bounded request for the durable OpenWaggle task tool.',
      argsSchema: z.object({ objective: z.string(), projectPath: z.string() }),
    },
    ({ objective, projectPath }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Start a durable OpenWaggle task with projectPath=${JSON.stringify(projectPath)} and this objective. OpenWaggle will use the target session's model profile (or the desktop default for a new session):\n\n${objective}`,
          },
        },
      ],
    }),
  )
}

function createOpenWaggleMcpServer(
  options: OpenWaggleMcpServeOptions,
  tasks: OpenWaggleServerTaskManager,
  sessionMetadata: OpenWaggleMcpSessionMetadataStore,
) {
  const server = new McpServer(
    { name: 'OpenWaggle', version: options.version },
    {
      instructions:
        'Use openwaggle_task for durable agent work and openwaggle_sessions only for explicitly granted session operations. Raw shell and transparent upstream MCP passthrough are intentionally unavailable.',
      cacheHints: {
        'tools/list': { ttlMs: CATALOG_CACHE_TTL_MS, cacheScope: 'private' },
        'prompts/list': { ttlMs: CATALOG_CACHE_TTL_MS, cacheScope: 'private' },
        'resources/list': { ttlMs: RESOURCE_LIST_CACHE_TTL_MS, cacheScope: 'private' },
        'resources/read': { ttlMs: 0, cacheScope: 'private' },
        'server/discover': { ttlMs: CATALOG_CACHE_TTL_MS, cacheScope: 'private' },
      },
    },
  )
  registerServerResources(server, options, tasks, sessionMetadata)
  registerServerPrompt(server)
  registerOpenWaggleTaskTool(server, options, tasks, sessionMetadata)
  registerOpenWaggleSessionTool(server, options, tasks, sessionMetadata, {
    materializeWorktree: materializeHostedSessionWorktree,
    removeWorktree: removeHostedSessionWorktree,
  })
  return server
}

export async function serveOpenWaggleMcpServer(options: OpenWaggleMcpServeOptions) {
  await initializeAppRuntime()
  if (options.originSessionId) {
    const originExists = await runAppEffect(
      Effect.gen(function* () {
        const sessions = yield* SessionProjectionRepository
        return Boolean(yield* sessions.getOptional(SessionId(options.originSessionId ?? '')))
      }),
    )
    if (!originExists) {
      throw new Error(
        `Configured origin session ${JSON.stringify(options.originSessionId)} was not found. Update the owner-controlled server profile before retrying.`,
      )
    }
  }
  const sessionMetadata = new OpenWaggleMcpSessionMetadataStore(
    sessionMetadataStorePath(options.taskStorePath),
  )
  const tasks = new OpenWaggleServerTaskManager(options, sessionMetadata)
  await runAppEffect(tasks.recoverInterruptedTasks())
  const factory = () => createOpenWaggleMcpServer(options, tasks, sessionMetadata)
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
      await runAppEffect(tasks.cancelAll())
      await handle.close().catch(() => undefined)
      await disposeAppRuntime().catch(() => undefined)
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
    await runAppEffect(tasks.cancelAll())
    await handle.close().catch(() => undefined)
    await disposeAppRuntime().catch(() => undefined)
  }
  await new Promise<void>((resolve, reject) => {
    process.stdin.once('end', resolve)
    process.stdin.once('close', resolve)
    process.stdin.once('error', reject)
  }).finally(close)
}
