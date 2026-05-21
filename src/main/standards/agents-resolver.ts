import fs from 'node:fs/promises'
import path from 'node:path'
import { matchBy } from '@diegogbrisa/ts-match'
import type { AgentsResolutionResult, AgentsScopeItem } from '@shared/types/standards'
import { isEnoent } from '@shared/utils/node-error'
import { isPathInside } from '../utils/paths'

export async function resolveRootAgents(projectPath: string): Promise<AgentsScopeItem> {
  return readAgentsScope(projectPath, projectPath)
}

export async function resolveAgentsChainForPath(
  projectPath: string,
  targetPath: string,
): Promise<AgentsResolutionResult> {
  const root = await resolveRootAgents(projectPath)
  const warnings: string[] = []
  matchBy(root, 'status')
    .with('error', (value) => {
      if (value.error) {
        warnings.push(`Failed to load root AGENTS.md: ${value.error}`)
      }
    })
    .with('found', 'missing', () => undefined)
    .exhaustive()

  const targetDir = await resolveTargetDirectoryWithinProject(projectPath, targetPath)
  const dirs = listScopeDirectories(projectPath, targetDir)
  const scoped: AgentsScopeItem[] = []

  for (const dir of dirs.slice(1)) {
    const scope = await readAgentsScope(projectPath, dir)
    matchBy(scope, 'status')
      .with('found', (value) => {
        scoped.push(value)
      })
      .with('error', (value) => {
        if (value.error) {
          warnings.push(
            `Failed to load AGENTS.md for scope "${value.scopeRelativeDir}": ${value.error}`,
          )
        }
      })
      .with('missing', () => undefined)
      .exhaustive()
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
  const seenWarnings = new Set<string>()
  const warnings: string[] = []
  const addWarning = (warning: string) => {
    if (seenWarnings.has(warning)) return
    seenWarnings.add(warning)
    warnings.push(warning)
  }

  matchBy(root, 'status')
    .with('error', (value) => {
      if (value.error) {
        addWarning(`Failed to load root AGENTS.md: ${value.error}`)
      }
    })
    .with('found', 'missing', () => undefined)
    .exhaustive()

  const scopedByFilePath = new Map<string, AgentsScopeItem>()
  for (const candidatePath of candidatePaths) {
    try {
      const chain = await resolveAgentsChainForPath(projectPath, candidatePath)
      for (const warning of chain.warnings) {
        addWarning(warning)
      }
      for (const scope of chain.scoped) {
        if (!scopedByFilePath.has(scope.filePath)) {
          scopedByFilePath.set(scope.filePath, scope)
        }
      }
    } catch (error) {
      addWarning(
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

  matchBy(resolution.root, 'status')
    .with('found', (root) => {
      if (root.content.trim()) {
        sections.push(`Root scope (${root.filePath})\n${root.content.trim()}`)
      }
    })
    .with('missing', 'error', () => undefined)
    .exhaustive()

  for (const scope of resolution.scoped) {
    matchBy(scope, 'status')
      .with('found', (value) => {
        if (value.content.trim()) {
          sections.push(
            `Scope ${value.scopeRelativeDir} (${value.filePath})\n${value.content.trim()}`,
          )
        }
      })
      .with('missing', 'error', () => undefined)
      .exhaustive()
  }

  return sections.join('\n\n')
}

async function resolveTargetDirectoryWithinProject(projectPath: string, targetPath: string) {
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
    if (isEnoent(error)) {
      return path.dirname(candidateAbsolutePath)
    }
    throw error
  }
}

async function resolveCandidatePathForBoundary(targetPath: string) {
  try {
    return await fs.realpath(targetPath)
  } catch (error) {
    if (!isEnoent(error)) {
      throw error
    }
  }

  let parent = path.dirname(targetPath)
  while (parent !== path.dirname(parent)) {
    try {
      return await fs.realpath(parent)
    } catch (error) {
      if (!isEnoent(error)) {
        throw error
      }
      parent = path.dirname(parent)
    }
  }

  return path.resolve(targetPath)
}

function listScopeDirectories(projectPath: string, targetDir: string) {
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
    if (isEnoent(error)) {
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

function toScopeRelativeDir(projectPath: string, scopeDir: string) {
  const relative = path.relative(path.resolve(projectPath), path.resolve(scopeDir))
  return relative.length === 0 ? '.' : relative
}

async function resolveRealPath(targetPath: string) {
  try {
    return await fs.realpath(targetPath)
  } catch (error) {
    if (isEnoent(error)) {
      return path.resolve(targetPath)
    }
    throw error
  }
}
