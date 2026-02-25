import type { AgentsLoadToolResult } from '@shared/types/standards'
import { z } from 'zod'
import {
  buildEffectiveAgentsInstruction,
  resolveAgentsChainForPath,
} from '../../standards/agents-resolver'
import type { ToolContext } from '../define-tool'
import { defineOpenWaggleTool } from '../define-tool'

const loadAgentsInputSchema = z.object({
  path: z.string().min(1).describe('File or directory path inside the project root.'),
})

export async function loadAgentsForRun(
  context: ToolContext,
  requestedPath: string,
): Promise<AgentsLoadToolResult> {
  const normalizedPath = requestedPath.trim()
  if (!normalizedPath) {
    return {
      ok: false,
      requestedPath: normalizedPath,
      alreadyLoaded: false,
      error: 'path is required',
    }
  }

  const loadedScopeFiles = context.dynamicAgents?.loadedScopeFiles
  const loadedRequestedPaths = context.dynamicAgents?.loadedRequestedPaths
  const wasPathRequested = loadedRequestedPaths?.has(normalizedPath) ?? false

  try {
    const resolution = await resolveAgentsChainForPath(context.projectPath, normalizedPath)
    const foundFiles = [
      ...(resolution.root.status === 'found' ? [resolution.root.filePath] : []),
      ...resolution.scoped.map((scope) => scope.filePath),
    ]

    const alreadyLoaded =
      wasPathRequested ||
      (foundFiles.length > 0 && foundFiles.every((file) => loadedScopeFiles?.has(file)))

    for (const file of foundFiles) {
      loadedScopeFiles?.add(file)
    }
    loadedRequestedPaths?.add(normalizedPath)

    const warning = resolution.warnings.length > 0 ? resolution.warnings.join(' | ') : undefined

    return {
      ok: true,
      requestedPath: normalizedPath,
      alreadyLoaded,
      resolution,
      effectiveInstruction: buildEffectiveAgentsInstruction(resolution),
      warning,
    }
  } catch (error) {
    return {
      ok: false,
      requestedPath: normalizedPath,
      alreadyLoaded: wasPathRequested,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export const loadAgentsTool = defineOpenWaggleTool({
  name: 'loadAgents',
  description:
    'Load effective AGENTS.md instructions for a target file/directory path inside the project. Use this when you need scoped instructions for nested packages during the current run.',
  inputSchema: loadAgentsInputSchema,
  async execute(args, context) {
    const result = await loadAgentsForRun(context, args.path)
    return JSON.stringify(result)
  },
})
