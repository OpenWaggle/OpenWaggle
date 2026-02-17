import path from 'node:path'
import { type ServerTool, toolDefinition } from '@tanstack/ai'
import type { z } from 'zod'

export interface ToolContext {
  projectPath: string
  signal?: AbortSignal
}

// Global mutable context set before each agent run
let currentToolContext: ToolContext = { projectPath: process.cwd() }

export function setToolContext(ctx: ToolContext): void {
  currentToolContext = ctx
}

export function getToolContext(): ToolContext {
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
    return config.execute(parsed, ctx)
  })
}

/** Validate and resolve a file path within the project directory */
export function resolveProjectPath(projectPath: string, filePath: string): string {
  const resolved = path.resolve(projectPath, filePath)
  if (!resolved.startsWith(path.resolve(projectPath))) {
    throw new Error(`Path "${filePath}" is outside the project directory`)
  }
  return resolved
}
