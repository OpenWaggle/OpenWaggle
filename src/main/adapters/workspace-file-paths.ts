import type { Stats } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { WorkspaceFileError } from '../errors'
import { isPathInsideDirectory } from '../utils/project-path-validation'

export interface ResolvedWorkspaceEntry {
  readonly projectRoot: string
  readonly relativePath: string
  readonly realPath: string
  readonly stats: Stats
}

export interface ResolvedWorkspaceFile extends ResolvedWorkspaceEntry {
  readonly realFilePath: string
}

export interface ResolvedNewWorkspaceEntry {
  readonly projectRoot: string
  readonly relativePath: string
  readonly targetPath: string
}

export function workspaceFileError(operation: string, cause: unknown) {
  return new WorkspaceFileError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  })
}

export async function resolveWorkspaceProjectRoot(projectPath: string) {
  const trimmed = projectPath.trim()
  if (!path.isAbsolute(trimmed)) throw new Error('Project path must be absolute.')
  const projectRoot = await fs.realpath(trimmed)
  const stats = await fs.stat(projectRoot)
  if (!stats.isDirectory()) throw new Error('Project path must be a directory.')
  return projectRoot
}

export function normalizeWorkspaceRelativePath(relativePath: string) {
  const slashPath = relativePath.replaceAll('\\', '/').trim()
  if (!slashPath || path.posix.isAbsolute(slashPath)) {
    throw new Error('Workspace file path must be relative.')
  }
  const normalized = path.posix.normalize(slashPath)
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Workspace file path cannot leave the project root.')
  }
  return normalized.replace(/^\.\//u, '')
}

export async function resolveExistingWorkspaceEntry(input: {
  readonly projectPath: string
  readonly path: string
}): Promise<ResolvedWorkspaceEntry> {
  const projectRoot = await resolveWorkspaceProjectRoot(input.projectPath)
  const relativePath = normalizeWorkspaceRelativePath(input.path)
  if (relativePath === '.') throw new Error('The workspace root cannot be mutated as an entry.')
  const candidatePath = path.resolve(projectRoot, relativePath)
  if (!isPathInsideDirectory(projectRoot, candidatePath)) {
    throw new Error('Workspace file path cannot leave the project root.')
  }
  const realPath = await fs.realpath(candidatePath)
  if (!isPathInsideDirectory(projectRoot, realPath)) {
    throw new Error('Workspace entry symlink resolves outside the project root.')
  }
  const candidateStats = await fs.lstat(candidatePath)
  if (candidateStats.isSymbolicLink()) {
    throw new Error('Workspace mutation does not follow symbolic-link entries.')
  }
  return { projectRoot, relativePath, realPath, stats: await fs.stat(realPath) }
}

export async function resolveExistingWorkspaceFile(input: {
  readonly projectPath: string
  readonly path: string
}): Promise<ResolvedWorkspaceFile> {
  const resolved = await resolveExistingWorkspaceEntry(input)
  if (!resolved.stats.isFile()) throw new Error('Workspace path must resolve to a file.')
  return { ...resolved, realFilePath: resolved.realPath }
}

export async function resolveNewWorkspaceEntry(input: {
  readonly projectPath: string
  readonly path: string
}): Promise<ResolvedNewWorkspaceEntry> {
  const projectRoot = await resolveWorkspaceProjectRoot(input.projectPath)
  const relativePath = normalizeWorkspaceRelativePath(input.path)
  if (relativePath === '.') throw new Error('Choose a path below the workspace root.')
  const targetPath = path.resolve(projectRoot, relativePath)
  if (!isPathInsideDirectory(projectRoot, targetPath)) {
    throw new Error('Workspace entry path cannot leave the project root.')
  }
  const realParentPath = await fs.realpath(path.dirname(targetPath))
  if (!isPathInsideDirectory(projectRoot, realParentPath)) {
    throw new Error('Workspace entry parent resolves outside the project root.')
  }
  return {
    projectRoot,
    relativePath,
    targetPath: path.join(realParentPath, path.basename(targetPath)),
  }
}
