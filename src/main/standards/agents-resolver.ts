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

  // Scope reads are independent; fetch concurrently then fold in directory order.
  const scopes = await Promise.all(dirs.slice(1).map((dir) => readAgentsScope(projectPath, dir)))
  for (const scope of scopes) {
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

/** The project's root AGENTS.md as a resolution with no directory scopes, for Settings > Skills. */
export async function resolveProjectRootAgents(
  projectPath: string,
): Promise<AgentsResolutionResult> {
  const root = await resolveRootAgents(projectPath)
  const warnings = matchBy(root, 'status')
    .with('error', (value) =>
      value.error ? [`Failed to load root AGENTS.md: ${value.error}`] : [],
    )
    .with('found', 'missing', () => [])
    .exhaustive()
  return { projectPath, root, scoped: [], warnings }
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
