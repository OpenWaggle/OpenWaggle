import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs'
import path from 'node:path'
import { BYTES_PER_KIBIBYTE, PERCENT_BASE } from '@shared/constants/constants'
import type { ConversationId } from '@shared/types/brand'
import { isPathInside } from '@shared/utils/paths'
import { type ServerTool, toolDefinition } from '@tanstack/ai'
import type { z } from 'zod'
import { createLogger } from '../logger'
import { emitContextInjected } from '../utils/stream-bridge'
import { applyContextInjection } from './context-injection-buffer'

const logger = createLogger('tools')
const MAX_TOOL_OUTPUT_BYTES = PERCENT_BASE * BYTES_PER_KIBIBYTE // 100 KB
const projectRootCache = new Map<string, string>()

import type { SubAgentContext } from '@shared/types/sub-agent'

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
  dynamicSkills?: {
    readonly loadedSkillIds: Set<string>
    readonly toggles: Readonly<Record<string, boolean>>
  }
  dynamicAgents?: {
    readonly loadedScopeFiles: Set<string>
    readonly loadedRequestedPaths: Set<string>
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

const toolContextStorage = new AsyncLocalStorage<ToolContext>()

export function runWithToolContext<T>(ctx: ToolContext, fn: () => T): T {
  return toolContextStorage.run(ctx, fn)
}

export function getToolContext(): ToolContext {
  const ctx = toolContextStorage.getStore()
  if (!ctx) {
    throw new Error('Tool context not set — agent run not active')
  }
  return ctx
}

/**
 * Define a OpenWaggle tool using TanStack AI's toolDefinition().
 * Uses Zod's own z.infer for type-safe args in execute().
 * Args are validated through Zod's .parse() at runtime,
 * and the schema is passed to TanStack AI for JSON Schema conversion.
 */
export function defineOpenWaggleTool<T extends z.ZodType, TName extends string>(config: {
  name: TName
  description: string
  needsApproval?: boolean
  inputSchema: T
  execute: (args: z.infer<T>, context: ToolContext) => Promise<string | NormalizedToolResult>
}): ServerTool {
  const def = toolDefinition({
    name: config.name,
    description: config.description,
    needsApproval: config.needsApproval,
    inputSchema: config.inputSchema,
  })

  return def.server(async (args: unknown) => {
    const parsed: z.infer<T> = config.inputSchema.parse(args)
    const ctx = getToolContext()
    const argKeys = typeof parsed === 'object' && parsed !== null ? Object.keys(parsed) : []
    logger.info('tool:start', { tool: config.name, argKeys })
    const startTime = Date.now()

    let rawResult: string | NormalizedToolResult
    try {
      rawResult = await config.execute(parsed, ctx)
    } catch (err) {
      const durationMs = Date.now() - startTime
      logger.error('tool:error', {
        tool: config.name,
        error: err instanceof Error ? err.message : String(err),
        durationMs,
      })
      throw err
    }

    const durationMs = Date.now() - startTime

    // Inject any user context that arrived while the tool was executing
    const injection = applyContextInjection(ctx.conversationId, rawResult)
    if (injection.injectedItems.length > 0) {
      rawResult = injection.result
      for (const item of injection.injectedItems) {
        emitContextInjected(ctx.conversationId, item.text, item.timestamp)
      }
      logger.info('tool:context-injected', {
        tool: config.name,
        conversationId: ctx.conversationId,
        count: injection.injectedItems.length,
      })
    }

    // If execute already returned a NormalizedToolResult, pass through directly
    if (typeof rawResult === 'object' && rawResult !== null && 'kind' in rawResult) {
      logger.info('tool:end', { tool: config.name, resultKind: rawResult.kind, durationMs })
      return rawResult
    }

    // Backward compat: string results go through truncation + normalization
    let result = rawResult
    const truncated = result.length > MAX_TOOL_OUTPUT_BYTES
    if (truncated) {
      result = `${result.slice(0, MAX_TOOL_OUTPUT_BYTES)}\n\n... [output truncated — ${result.length} bytes total, showing first ${MAX_TOOL_OUTPUT_BYTES}]`
    }

    logger.info('tool:end', { tool: config.name, resultKind: 'string', durationMs, truncated })
    return normalizeToolResult(result)
  })
}

function normalizeToolResult(result: string): NormalizedToolResult {
  try {
    const data: unknown = JSON.parse(result)
    return { kind: 'json', data }
  } catch {
    return { kind: 'text', text: result }
  }
}

/** Validate and resolve a file path within the project directory */
export function resolveProjectPath(projectPath: string, filePath: string): string {
  const resolved = path.resolve(projectPath, filePath)
  const projectRoot = path.resolve(projectPath)
  let projectRootReal = projectRootCache.get(projectPath)
  if (projectRootReal === undefined) {
    projectRootReal = fs.existsSync(projectRoot) ? fs.realpathSync(projectRoot) : projectRoot
    projectRootCache.set(projectPath, projectRootReal)
  }

  // For existing files, resolve symlinks before checking
  if (fs.existsSync(resolved)) {
    const real = fs.realpathSync(resolved)
    if (!isPathInside(projectRootReal, real)) {
      throw new Error(`Path "${filePath}" resolves outside the project directory (symlink)`)
    }
    return resolved
  }

  // For new files (write operations), validate the parent directory
  const parentDir = path.dirname(resolved)
  if (fs.existsSync(parentDir)) {
    const realParent = fs.realpathSync(parentDir)
    if (!isPathInside(projectRootReal, realParent)) {
      throw new Error(`Path "${filePath}" resolves outside the project directory (symlink)`)
    }
    return resolved
  }

  if (!isPathInside(projectRoot, resolved)) {
    throw new Error(`Path "${filePath}" is outside the project directory`)
  }

  return resolved
}
