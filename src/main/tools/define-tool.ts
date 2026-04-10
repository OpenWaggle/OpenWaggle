import path from 'node:path'
import { BYTES_PER_KIBIBYTE, PERCENT_BASE } from '@shared/constants/constants'
import { decodeUnknownOrThrow, type Schema, type SchemaType } from '@shared/schema'
import type { ConversationId } from '@shared/types/brand'
import type { AgentStreamChunk } from '@shared/types/stream'
import { type ServerTool, type ToolExecutionContext, toolDefinition } from '@tanstack/ai'
import { JSONSchema } from 'effect'
import type { WaggleFileCache } from '../agent/waggle-file-cache'
import { createLogger } from '../logger'
import type { DomainServerTool } from '../ports/tool-types'
import { emitContextInjected } from '../utils/stream-bridge'
import { applyContextInjection } from './context-injection-buffer'

const logger = createLogger('tools')
const MAX_TOOL_OUTPUT_BYTES = PERCENT_BASE * BYTES_PER_KIBIBYTE // 100 KB

/**
 * Convert an Effect Schema to a plain JSON Schema object that LLM providers accept.
 * Effect Schema is not Standard Schema compliant, so TanStack's `convertSchemaToJsonSchema`
 * passes it through as-is — which fails on OpenAI (expects `type: "object"`).
 */
function effectSchemaToJsonSchema(schema: Schema.Schema.AnyNoContext): Record<string, unknown> {
  const { $schema, ...rest } = JSONSchema.make(schema)
  return rest
}

import type { SubAgentContext } from '@shared/types/sub-agent'
import type { ChatStreamOptions } from '../ports/chat-service'

/** Re-export shared SubAgentContext for tool-layer consumption */
export type SubAgentToolContext = SubAgentContext

export interface ToolContext {
  conversationId: ConversationId
  projectPath: string
  attachments?: readonly {
    readonly name: string
    readonly extractedText: string
  }[]
  signal?: AbortSignal
  /** Domain-owned chat stream factory — forwarded to sub-agents for LLM calls. */
  chatStream?: (options: ChatStreamOptions) => AsyncIterable<AgentStreamChunk>
  dynamicSkills?: {
    readonly loadedSkillIds: Set<string>
    readonly toggles: Readonly<Record<string, boolean>>
  }
  dynamicAgents?: {
    readonly loadedScopeFiles: Set<string>
    readonly loadedRequestedPaths: Set<string>
  }
  waggle?: {
    readonly agentLabel: string
    readonly fileCache: WaggleFileCache
  }
  subAgentContext?: SubAgentToolContext
}

export interface ToolTextResult {
  kind: 'text'
  text: string
}

export interface ToolJsonResult {
  kind: 'json'
  data: unknown
}

/**
 * Soft errors (coordination failures) → return `{ ok: false, error }`. LLM sees and retries.
 * Hard errors (constraint violations) → throw Error. TanStack AI halts run.
 */
export type NormalizedToolResult = ToolTextResult | ToolJsonResult

const OPEN_WAGGLE_TOOL_BINDER = Symbol('openwaggle.tool-binder')

export interface ContextBoundServerTool extends ServerTool {
  readonly [OPEN_WAGGLE_TOOL_BINDER]: (context: ToolContext) => ServerTool
}

/** ContextBoundServerTool with the literal tool name preserved for type-level extraction. */
export interface NamedContextBoundServerTool<TName extends string> extends ContextBoundServerTool {
  readonly name: TName
}

interface ExecutableServerTool extends ServerTool {
  readonly execute: (args: unknown, context?: ToolExecutionContext) => Promise<unknown> | unknown
}

function isContextBoundServerTool(tool: DomainServerTool): tool is ContextBoundServerTool {
  return OPEN_WAGGLE_TOOL_BINDER in tool && typeof tool[OPEN_WAGGLE_TOOL_BINDER] === 'function'
}

function executeOpenWaggleTool<TSchema extends Schema.Schema.AnyNoContext>(
  config: {
    readonly name: string
    readonly execute: (
      args: SchemaType<TSchema>,
      context: ToolContext,
    ) => Promise<string | NormalizedToolResult>
    readonly inputSchema: TSchema
  },
  toolContext: ToolContext,
  args: unknown,
): Promise<NormalizedToolResult> {
  const parsed = decodeUnknownOrThrow(config.inputSchema, args)
  const debugEnabled = logger.isDebugEnabled?.() === true
  const argKeys =
    debugEnabled && typeof parsed === 'object' && parsed !== null ? Object.keys(parsed) : []
  if (debugEnabled) {
    logger.debug('tool:start', { tool: config.name, argKeys })
  }
  const startTime = Date.now()

  return config
    .execute(parsed, toolContext)
    .then((rawToolResult) => {
      const durationMs = Date.now() - startTime
      const injection = applyContextInjection(toolContext.conversationId, rawToolResult)
      let resultWithContext = injection.result

      if (injection.injectedItems.length > 0) {
        for (const item of injection.injectedItems) {
          emitContextInjected(toolContext.conversationId, item.text, item.timestamp)
        }
        if (debugEnabled) {
          logger.debug('tool:context-injected', {
            tool: config.name,
            conversationId: toolContext.conversationId,
            count: injection.injectedItems.length,
          })
        }
      }

      if (
        typeof resultWithContext === 'object' &&
        resultWithContext !== null &&
        'kind' in resultWithContext
      ) {
        if (debugEnabled) {
          logger.debug('tool:end', {
            tool: config.name,
            resultKind: resultWithContext.kind,
            durationMs,
          })
        }
        return resultWithContext
      }

      const rawText = resultWithContext
      const truncated = rawText.length > MAX_TOOL_OUTPUT_BYTES
      if (truncated) {
        resultWithContext = `${rawText.slice(0, MAX_TOOL_OUTPUT_BYTES)}\n\n... [output truncated — ${rawText.length} bytes total, showing first ${MAX_TOOL_OUTPUT_BYTES}]`
      }

      if (debugEnabled) {
        logger.debug('tool:end', {
          tool: config.name,
          resultKind: 'string',
          durationMs,
          truncated,
        })
      }
      return normalizeToolResult(resultWithContext)
    })
    .catch((error) => {
      const durationMs = Date.now() - startTime
      logger.error('tool:error', {
        tool: config.name,
        error: error instanceof Error ? error.message : String(error),
        durationMs,
      })
      throw error
    })
}

function makeServerToolWithContext<
  TSchema extends Schema.Schema.AnyNoContext,
  TName extends string,
>(
  config: {
    readonly name: TName
    readonly description: string
    readonly needsApproval?: boolean
    readonly inputSchema: TSchema
    readonly execute: (
      args: SchemaType<TSchema>,
      context: ToolContext,
    ) => Promise<string | NormalizedToolResult>
  },
  toolContext: ToolContext,
): ServerTool {
  const def = toolDefinition({
    name: config.name,
    description: config.description,
    needsApproval: config.needsApproval,
    inputSchema: effectSchemaToJsonSchema(config.inputSchema),
  })

  return def.server((args: unknown, _executionContext?: ToolExecutionContext) =>
    executeOpenWaggleTool(config, toolContext, args),
  )
}

export function bindToolContextToTool(
  tool: DomainServerTool,
  context: ToolContext,
): DomainServerTool {
  if (!isContextBoundServerTool(tool)) {
    return tool
  }

  const boundTool = tool[OPEN_WAGGLE_TOOL_BINDER](context)

  // Tool approval can be stripped at the feature/prompt layer (for example
  // waggle skipApproval or full-access execution mode). Preserve that override
  // when materializing context-bound tools.
  if (tool.needsApproval === false && boundTool.needsApproval !== false) {
    return { ...boundTool, needsApproval: false }
  }

  return boundTool
}

export function bindToolContextToTools(
  tools: readonly DomainServerTool[],
  context: ToolContext,
): DomainServerTool[] {
  return tools.map((tool) => bindToolContextToTool(tool, context))
}

function hasExecutableServerFunction(tool: DomainServerTool): tool is ExecutableServerTool {
  return 'execute' in tool && typeof tool.execute === 'function'
}

export async function executeToolWithContext(
  tool: DomainServerTool,
  context: ToolContext,
  args: unknown,
): Promise<unknown> {
  const boundTool = bindToolContextToTool(tool, context)
  if (!hasExecutableServerFunction(boundTool)) {
    throw new Error(`Tool "${boundTool.name ?? 'unknown'}" is missing execute()`)
  }
  return boundTool.execute(args)
}

/**
 * Define an OpenWaggle tool using TanStack AI's toolDefinition().
 *
 * Uses Effect Schema for type-safe args in execute(). The return type
 * preserves the literal `name` via `NamedContextBoundServerTool<TName>`,
 * which lets `builtInTools` derive a `BuiltInToolName` union automatically.
 *
 * When adding a new tool: create a file in `src/main/tools/tools/`, call
 * `defineOpenWaggleTool({ name: 'myTool', ... })`, and add the export to
 * the `builtInTools` array in `built-in-tools.ts`. The `BuiltInToolName`
 * type updates automatically — no manual name lists to maintain.
 */
export function defineOpenWaggleTool<
  TSchema extends Schema.Schema.AnyNoContext,
  TName extends string,
>(config: {
  name: TName
  description: string
  needsApproval?: boolean
  inputSchema: TSchema
  execute: (
    args: SchemaType<TSchema>,
    context: ToolContext,
  ) => Promise<string | NormalizedToolResult>
}): NamedContextBoundServerTool<TName> {
  const def = toolDefinition({
    name: config.name,
    description: config.description,
    needsApproval: config.needsApproval,
    inputSchema: effectSchemaToJsonSchema(config.inputSchema),
  })

  return {
    ...def.server((_args: unknown) => {
      throw new Error(`Tool "${config.name}" executed without a bound ToolContext`)
    }),
    name: config.name,
    execute: (_args: unknown) => {
      throw new Error(`Tool "${config.name}" executed without a bound ToolContext`)
    },
    [OPEN_WAGGLE_TOOL_BINDER]: (context: ToolContext) => makeServerToolWithContext(config, context),
  }
}

function normalizeToolResult(result: string): NormalizedToolResult {
  try {
    const data: unknown = JSON.parse(result)
    return { kind: 'json', data }
  } catch {
    return { kind: 'text', text: result }
  }
}

/**
 * Resolve a file path for tool operations.
 * Absolute paths are returned as-is. Relative paths are resolved against the project root.
 */
export function resolvePath(projectPath: string, filePath: string): string {
  return path.resolve(projectPath, filePath)
}
