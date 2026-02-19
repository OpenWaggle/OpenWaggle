import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs'
import path from 'node:path'
import type { ConversationId } from '@shared/types/brand'
import type { ExecutionMode } from '@shared/types/settings'
import { type ServerTool, toolDefinition } from '@tanstack/ai'
import type { z } from 'zod'

const MAX_TOOL_OUTPUT_BYTES = 100 * 1024 // 100 KB

export interface ToolContext {
  conversationId: ConversationId
  projectPath: string
  executionMode: ExecutionMode
  signal?: AbortSignal
}

export interface ToolTextResult {
  kind: 'text'
  text: string
}

export interface ToolJsonResult {
  kind: 'json'
  data: unknown
}

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
 * Define a OpenHive tool using TanStack AI's toolDefinition().
 * Uses Zod's own z.infer for type-safe args in execute().
 * Args are validated through Zod's .parse() at runtime,
 * and the schema is passed to TanStack AI for JSON Schema conversion.
 */
export function defineOpenHiveTool<T extends z.ZodType, TName extends string>(config: {
  name: TName
  description: string
  needsApproval?: boolean
  inputSchema: T
  execute: (args: z.infer<T>, context: ToolContext) => Promise<string>
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
    if (ctx.executionMode === 'sandbox' && config.needsApproval) {
      throw new Error(`Tool "${config.name}" is blocked in sandbox mode`)
    }
    let result = await config.execute(parsed, ctx)

    // Truncate oversized tool output
    if (result.length > MAX_TOOL_OUTPUT_BYTES) {
      result = `${result.slice(0, MAX_TOOL_OUTPUT_BYTES)}\n\n... [output truncated — ${result.length} bytes total, showing first ${MAX_TOOL_OUTPUT_BYTES}]`
    }

    return normalizeToolResult(result)
  })
}

function normalizeToolResult(result: string): NormalizedToolResult {
  try {
    return { kind: 'json', data: JSON.parse(result) as unknown }
  } catch {
    return { kind: 'text', text: result }
  }
}

function isPathInside(basePath: string, targetPath: string): boolean {
  const relative = path.relative(basePath, targetPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/** Validate and resolve a file path within the project directory */
export function resolveProjectPath(projectPath: string, filePath: string): string {
  const resolved = path.resolve(projectPath, filePath)
  const projectRoot = path.resolve(projectPath)
  const projectRootReal = fs.existsSync(projectRoot) ? fs.realpathSync(projectRoot) : projectRoot

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
  } else if (!isPathInside(projectRoot, resolved)) {
    throw new Error(`Path "${filePath}" is outside the project directory`)
  }

  return resolved
}
