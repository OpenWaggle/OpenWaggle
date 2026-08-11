import { MCP_CONFIG } from '@shared/constants/mcp'
import type {
  McpGatewayInput,
  McpGatewayResult,
  McpJsonValue,
  McpToolDescriptor,
  McpTurnSnapshot,
} from '@shared/types/mcp'
import { Effect } from 'effect'
import {
  McpRuntimeError,
  type McpRuntimeFailure,
  toMcpRuntimeError,
} from '../../../ports/mcp-errors'
import type { McpRuntimeInteractions } from '../../../ports/mcp-runtime-service'
import { appResourceUri } from './capability-descriptors'
import type { CatalogTool, McpRuntimeStateService } from './runtime-state'

const EXACT_MATCH_SCORE = 100
const PREFIX_MATCH_SCORE = 80
const CONTAINS_MATCH_SCORE = 60
const DESCRIPTION_MATCH_SCORE = 30
const ALL_TERMS_MATCH_SCORE = 10

function toDescriptor(catalogTool: CatalogTool, includeSchema: boolean): McpToolDescriptor {
  return {
    handle: catalogTool.handle,
    title: catalogTool.tool.title ?? catalogTool.tool.name,
    ...(catalogTool.tool.description ? { description: catalogTool.tool.description } : {}),
    ...(includeSchema && catalogTool.tool.inputSchema
      ? { inputSchema: catalogTool.tool.inputSchema }
      : {}),
    ...(includeSchema && catalogTool.tool.outputSchema
      ? { outputSchema: catalogTool.tool.outputSchema }
      : {}),
    ...(includeSchema && catalogTool.tool.annotations
      ? { annotations: catalogTool.tool.annotations }
      : {}),
  }
}

function normalizedSearchText(tool: CatalogTool) {
  return [tool.tool.name, tool.tool.title, tool.tool.description]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLocaleLowerCase()
}

function searchScore(tool: CatalogTool, query: string) {
  const name = tool.tool.name.toLocaleLowerCase()
  const title = tool.tool.title?.toLocaleLowerCase() ?? ''
  const haystack = normalizedSearchText(tool)
  if (name === query || title === query) return EXACT_MATCH_SCORE
  if (name.startsWith(query) || title.startsWith(query)) return PREFIX_MATCH_SCORE
  if (name.includes(query) || title.includes(query)) return CONTAINS_MATCH_SCORE
  if (haystack.includes(query)) return DESCRIPTION_MATCH_SCORE
  const terms = query.split(/\s+/).filter(Boolean)
  return terms.length > 0 && terms.every((term) => haystack.includes(term))
    ? ALL_TERMS_MATCH_SCORE
    : 0
}

function isArgumentObject(value: McpJsonValue | undefined): value is Record<string, McpJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function byteLength(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function listTools(state: McpRuntimeStateService, snapshot: McpTurnSnapshot) {
  return state.loadCatalog(snapshot).pipe(
    Effect.map((catalog) => {
      const tools = catalog
        .slice()
        .sort((left, right) =>
          (left.tool.title ?? left.tool.name).localeCompare(right.tool.title ?? right.tool.name),
        )
        .slice(0, MCP_CONFIG.MAX_GATEWAY_RESULTS)
      return {
        operation: 'list' as const,
        text: `${String(tools.length)} MCP tools available. Describe a handle before calling it.`,
        tools: tools.map((tool) => toDescriptor(tool, false)),
      }
    }),
  )
}

function searchTools(
  state: McpRuntimeStateService,
  snapshot: McpTurnSnapshot,
  request: McpGatewayInput,
) {
  return Effect.gen(function* () {
    const query = request.query?.trim().toLocaleLowerCase()
    if (!query)
      return yield* Effect.fail(
        new McpRuntimeError({
          operation: 'search',
          message: 'MCP search requires a non-empty query.',
        }),
      )
    const matches: { readonly tool: CatalogTool; readonly score: number }[] = []
    for (const tool of yield* state.loadCatalog(snapshot)) {
      const score = searchScore(tool, query)
      if (score > 0) matches.push({ tool, score })
    }
    matches.sort((left, right) => right.score - left.score)
    const tools: CatalogTool[] = []
    for (const match of matches) {
      if (tools.length >= MCP_CONFIG.MAX_GATEWAY_RESULTS) break
      tools.push(match.tool)
    }
    return {
      operation: 'search' as const,
      text: `${String(tools.length)} MCP tools matched ${JSON.stringify(request.query?.trim())}.`,
      tools: tools.map((tool) => toDescriptor(tool, false)),
    }
  })
}

export function executeMcpGateway(
  state: McpRuntimeStateService,
  snapshot: McpTurnSnapshot,
  request: McpGatewayInput,
  signal?: AbortSignal,
  interactions?: McpRuntimeInteractions,
): Effect.Effect<McpGatewayResult, McpRuntimeFailure> {
  return Effect.gen(function* () {
    if (snapshot.effectiveState !== 'on')
      return yield* Effect.fail(
        new McpRuntimeError({ operation: 'gateway', message: 'MCP is off for this turn.' }),
      )
    if (request.operation === 'list') return yield* listTools(state, snapshot)
    if (request.operation === 'search') return yield* searchTools(state, snapshot, request)
    if (!request.handle)
      return yield* Effect.fail(
        new McpRuntimeError({
          operation: request.operation,
          message: `MCP ${request.operation} requires a tool handle.`,
        }),
      )
    yield* state.loadCatalog(snapshot)
    const catalogTool = yield* state.findHandle(snapshot, request.handle)
    if (request.operation === 'describe') {
      return {
        operation: 'describe',
        text: 'Tool schema loaded. Use the same handle to call it.',
        tools: [toDescriptor(catalogTool, true)],
        attribution: {
          serverInstanceId: catalogTool.server.instanceId,
          serverLabel: catalogTool.server.name,
          toolName: catalogTool.tool.name,
        },
      }
    }
    if (!isArgumentObject(request.arguments)) {
      return yield* Effect.fail(
        new McpRuntimeError({
          operation: 'call',
          message: 'MCP tool arguments must be a JSON object.',
        }),
      )
    }
    const callArguments = request.arguments
    const result = yield* Effect.tryPromise({
      try: () =>
        catalogTool.connection.callTool({
          name: catalogTool.tool.name,
          arguments: callArguments,
          signal,
          interactions,
        }),
      catch: (error) => toMcpRuntimeError('callTool', error),
    })
    if (byteLength(result) > MCP_CONFIG.MAX_RESULT_BYTES) {
      return yield* Effect.fail(
        new McpRuntimeError({
          operation: 'call',
          message: `MCP tool result exceeded the ${String(MCP_CONFIG.MAX_RESULT_BYTES)} byte safety limit.`,
        }),
      )
    }
    const resourceUri = appResourceUri(catalogTool)
    return {
      operation: 'call',
      text: result.isError ? 'MCP tool returned an error.' : 'MCP tool completed.',
      result: result.structuredContent ?? result.content,
      isError: result.isError,
      attribution: {
        serverInstanceId: catalogTool.server.instanceId,
        serverLabel: catalogTool.server.name,
        toolName: catalogTool.tool.name,
      },
      ...(resourceUri
        ? {
            app: {
              descriptor: {
                serverInstanceId: catalogTool.server.instanceId,
                serverLabel: catalogTool.server.name,
                toolHandle: catalogTool.handle,
                toolName: catalogTool.tool.name,
                toolTitle: catalogTool.tool.title ?? catalogTool.tool.name,
                resourceUri,
                allowedNetworkDomains: catalogTool.server.definition.security?.networkDomains ?? [],
              },
              toolResult: {
                content: result.content,
                ...(result.structuredContent === undefined
                  ? {}
                  : { structuredContent: result.structuredContent }),
                isError: result.isError,
              },
            },
          }
        : {}),
    }
  })
}
