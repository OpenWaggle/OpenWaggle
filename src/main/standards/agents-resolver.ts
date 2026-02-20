import fs from 'node:fs/promises'
import path from 'node:path'
import type { AgentsResolutionResult, AgentsScopeItem } from '@shared/types/standards'

export async function resolveRootAgents(projectPath: string): Promise<AgentsScopeItem> {
  return readAgentsScope(projectPath, projectPath)
}

export async function resolveAgentsChainForPath(
  projectPath: string,
  targetPath: string,
): Promise<AgentsResolutionResult> {
  const root = await resolveRootAgents(projectPath)
  const warnings: string[] = []
  if (root.status === 'error' && root.error) {
    warnings.push(`Failed to load root AGENTS.md: ${root.error}`)
  }

  const targetDir = await resolveTargetDirectoryWithinProject(projectPath, targetPath)
  const dirs = listScopeDirectories(projectPath, targetDir)
  const scoped: AgentsScopeItem[] = []

  for (const dir of dirs.slice(1)) {
    const scope = await readAgentsScope(projectPath, dir)
    if (scope.status === 'found') {
      scoped.push(scope)
      continue
    }

    if (scope.status === 'error' && scope.error) {
      warnings.push(
        `Failed to load AGENTS.md for scope "${scope.scopeRelativeDir}": ${scope.error}`,
      )
    }
  }

  return {
    projectPath,
    root,
    scoped,
    warnings,
  }
}

export async function resolveAgentsForRun(
  projectPath: string,
  candidatePaths: readonly string[],
): Promise<AgentsResolutionResult> {
  const root = await resolveRootAgents(projectPath)
  const warnings: string[] = []
  if (root.status === 'error' && root.error) {
    warnings.push(`Failed to load root AGENTS.md: ${root.error}`)
  }

  const scopedByFilePath = new Map<string, AgentsScopeItem>()
  for (const candidatePath of candidatePaths) {
    try {
      const chain = await resolveAgentsChainForPath(projectPath, candidatePath)
      warnings.push(...chain.warnings)
      for (const scope of chain.scoped) {
        if (!scopedByFilePath.has(scope.filePath)) {
          scopedByFilePath.set(scope.filePath, scope)
        }
      }
    } catch (error) {
      warnings.push(
        `Failed to resolve AGENTS scope for "${candidatePath}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return {
    projectPath,
    root,
    scoped: [...scopedByFilePath.values()],
    warnings,
  }
}

export function buildEffectiveAgentsInstruction(resolution: AgentsResolutionResult): string {
  const sections: string[] = []

  if (resolution.root.status === 'found' && resolution.root.content.trim()) {
    sections.push(`Root scope (${resolution.root.filePath})\n${resolution.root.content.trim()}`)
  }

  for (const scope of resolution.scoped) {
    if (scope.status !== 'found' || !scope.content.trim()) continue
    sections.push(`Scope ${scope.scopeRelativeDir} (${scope.filePath})\n${scope.content.trim()}`)
  }

  return sections.join('\n\n')
}

async function resolveTargetDirectoryWithinProject(
  projectPath: string,
  targetPath: string,
): Promise<string> {
  const projectRoot = path.resolve(projectPath)
  const projectRootReal = await resolveRealPath(projectRoot)
  const candidateAbsolutePath = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(projectRoot, targetPath)

  const candidateForBoundary = await resolveCandidatePathForBoundary(candidateAbsolutePath)
  if (!isPathInside(projectRootReal, candidateForBoundary)) {
    throw new Error('Target path resolves outside the project directory')
  }

  try {
    const stat = await fs.stat(candidateAbsolutePath)
    return stat.isDirectory() ? candidateAbsolutePath : path.dirname(candidateAbsolutePath)
  } catch (error) {
    if (isMissingError(error)) {
      return path.dirname(candidateAbsolutePath)
    }
    throw error
  }
}

async function resolveCandidatePathForBoundary(targetPath: string): Promise<string> {
  try {
    return await fs.realpath(targetPath)
  } catch (error) {
    if (!isMissingError(error)) {
      throw error
    }
  }

  let parent = path.dirname(targetPath)
  while (parent !== path.dirname(parent)) {
    try {
      return await fs.realpath(parent)
    } catch (error) {
      if (!isMissingError(error)) {
        throw error
      }
      parent = path.dirname(parent)
    }
  }

  return path.resolve(targetPath)
}

function listScopeDirectories(projectPath: string, targetDir: string): string[] {
  const root = path.resolve(projectPath)
  const relative = path.relative(root, path.resolve(targetDir))
  if (!relative || relative === '.') {
    return [root]
  }

  const segments = relative.split(path.sep).filter((segment) => segment.length > 0)
  const dirs = [root]
  let current = root
  for (const segment of segments) {
    current = path.join(current, segment)
    dirs.push(current)
  }

  return dirs
}

async function readAgentsScope(projectPath: string, scopeDir: string): Promise<AgentsScopeItem> {
  const filePath = path.join(scopeDir, 'AGENTS.md')
  const scopeRelativeDir = toScopeRelativeDir(projectPath, scopeDir)

  try {
    const content = await fs.readFile(filePath, 'utf8')
    return {
      filePath,
      scopeDir,
      scopeRelativeDir,
      content,
      status: 'found',
    }
  } catch (error) {
    if (isMissingError(error)) {
      return {
        filePath,
        scopeDir,
        scopeRelativeDir,
        content: '',
        status: 'missing',
      }
    }

    return {
      filePath,
      scopeDir,
      scopeRelativeDir,
      content: '',
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function toScopeRelativeDir(projectPath: string, scopeDir: string): string {
  const relative = path.relative(path.resolve(projectPath), path.resolve(scopeDir))
  return relative.length === 0 ? '.' : relative
}

async function resolveRealPath(targetPath: string): Promise<string> {
  try {
    return await fs.realpath(targetPath)
  } catch (error) {
    if (isMissingError(error)) {
      return path.resolve(targetPath)
    }
    throw error
  }
}

function isPathInside(basePath: string, targetPath: string): boolean {
  const relative = path.relative(basePath, targetPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function isMissingError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  )
}
