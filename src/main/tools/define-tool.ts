import fs from 'node:fs'
import path from 'node:path'
import { type ServerTool, toolDefinition } from '@tanstack/ai'
import type { z } from 'zod'

const MAX_TOOL_OUTPUT_BYTES = 100 * 1024 // 100 KB

export interface ToolContext {
  projectPath: string
  signal?: AbortSignal
}

// Global mutable context set before each agent run
let currentToolContext: ToolContext | null = null

export function setToolContext(ctx: ToolContext): void {
  currentToolContext = ctx
}

export function clearToolContext(): void {
  currentToolContext = null
}

export function getToolContext(): ToolContext {
  if (!currentToolContext) {
    throw new Error('Tool context not set — agent run not active')
  }
  return currentToolContext
}

/**
 * Define a HiveCode tool using TanStack AI's toolDefinition().
 * Uses Zod's own z.infer for type-safe args in execute().
 * Args are validated through Zod's .parse() at runtime,
 * and the schema is passed to TanStack AI for JSON Schema conversion.
 */
export function defineHiveCodeTool<T extends z.ZodType, TName extends string>(config: {
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
    let result = await config.execute(parsed, ctx)

    // Truncate oversized tool output
    if (result.length > MAX_TOOL_OUTPUT_BYTES) {
      result = `${result.slice(0, MAX_TOOL_OUTPUT_BYTES)}\n\n... [output truncated — ${result.length} bytes total, showing first ${MAX_TOOL_OUTPUT_BYTES}]`
    }

    return result
  })
}

/** Validate and resolve a file path within the project directory */
export function resolveProjectPath(projectPath: string, filePath: string): string {
  const resolved = path.resolve(projectPath, filePath)
  const projectRoot = path.resolve(projectPath)

  // For existing files, resolve symlinks before checking
  if (fs.existsSync(resolved)) {
    const real = fs.realpathSync(resolved)
    if (!real.startsWith(projectRoot)) {
      throw new Error(`Path "${filePath}" resolves outside the project directory (symlink)`)
    }
    return resolved
  }

  // For new files (write operations), validate the parent directory
  const parentDir = path.dirname(resolved)
  if (fs.existsSync(parentDir)) {
    const realParent = fs.realpathSync(parentDir)
    if (!realParent.startsWith(projectRoot)) {
      throw new Error(`Path "${filePath}" resolves outside the project directory (symlink)`)
    }
  } else if (!resolved.startsWith(projectRoot)) {
    throw new Error(`Path "${filePath}" is outside the project directory`)
  }

  return resolved
}
