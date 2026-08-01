import { lstat } from 'node:fs/promises'
import path from 'node:path'
import type { GitWorkingTreeMutationFailure, GitWorkingTreeMutationResult } from '@shared/types/git'
import { isGitRepository, runGit } from './shared'

function workingTreeFailure(
  code: GitWorkingTreeMutationFailure['code'],
  message: string,
): GitWorkingTreeMutationFailure {
  return { ok: false, code, message }
}

function nulSeparatedPaths(stdout: string) {
  return stdout.split('\0').filter(Boolean)
}

async function pathExistsWithType(filePath: string) {
  try {
    return await lstat(filePath)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

function hasIndexedDescendant(indexPaths: ReadonlySet<string>, gitPath: string) {
  const prefix = `${gitPath}/`
  for (const indexPath of indexPaths) {
    if (indexPath.startsWith(prefix)) return true
  }
  return false
}

async function isNestedRepository(filePath: string, isDirectory: boolean) {
  if (!isDirectory) return false
  return (await pathExistsWithType(path.join(filePath, '.git'))) !== null
}

async function findTrackedRestoreObstruction(
  repositoryPath: string,
  trackedPaths: readonly string[],
  indexPaths: ReadonlySet<string>,
) {
  for (const trackedPath of trackedPaths) {
    const segments = trackedPath.split('/')
    for (let segmentCount = 1; segmentCount <= segments.length; segmentCount += 1) {
      const gitPath = segments.slice(0, segmentCount).join('/')
      const filePath = path.join(repositoryPath, ...segments.slice(0, segmentCount))
      const file = await pathExistsWithType(filePath)
      if (!file) break
      if (await isNestedRepository(filePath, file.isDirectory())) return gitPath

      const isHeadFile = segmentCount === segments.length
      if (!isHeadFile && file.isDirectory()) continue
      if (!isHeadFile && indexPaths.has(gitPath)) break
      if (isHeadFile && !file.isDirectory() && indexPaths.has(gitPath)) break
      if (isHeadFile && file.isDirectory() && hasIndexedDescendant(indexPaths, gitPath)) break
      return gitPath
    }
  }
  return null
}

async function inspectTrackedRestore(projectPath: string) {
  const repositoryResult = await runGit(projectPath, ['rev-parse', '--show-toplevel'])
  if (repositoryResult.code !== 0) return null

  const repositoryPath = repositoryResult.stdout.replace(/\r?\n$/, '')
  const [headPathsResult, indexPathsResult] = await Promise.all([
    runGit(repositoryPath, ['ls-tree', '-r', '-z', '--name-only', 'HEAD']),
    runGit(repositoryPath, ['ls-files', '-z']),
  ])
  if (headPathsResult.code !== 0 || indexPathsResult.code !== 0) return null

  const headPaths = nulSeparatedPaths(headPathsResult.stdout)
  const indexPaths = new Set(nulSeparatedPaths(indexPathsResult.stdout))

  return {
    repositoryPath,
    obstruction: await findTrackedRestoreObstruction(
      repositoryPath,
      [...new Set([...headPaths, ...indexPaths])],
      indexPaths,
    ),
  }
}

export async function stageAllGitChanges(
  projectPath: string,
): Promise<GitWorkingTreeMutationResult> {
  if (!(await isGitRepository(projectPath))) {
    return workingTreeFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }

  const result = await runGit(projectPath, ['add', '--all', '--', ':/'])
  if (result.code !== 0) {
    return workingTreeFailure('unknown', result.stderr.trim() || 'Failed to stage changes.')
  }

  return { ok: true, message: 'All working-tree changes staged.' }
}

export async function revertAllGitChanges(
  projectPath: string,
): Promise<GitWorkingTreeMutationResult> {
  if (!(await isGitRepository(projectPath))) {
    return workingTreeFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }

  const headResult = await runGit(projectPath, ['rev-parse', '--verify', 'HEAD'])
  if (headResult.code !== 0) {
    return workingTreeFailure(
      'no-head',
      'Revert all requires a repository with at least one commit.',
    )
  }

  const inspection = await inspectTrackedRestore(projectPath)
  if (!inspection) {
    return workingTreeFailure('unknown', 'Failed to inspect paths before reverting changes.')
  }
  if (inspection.obstruction) {
    return workingTreeFailure(
      'unsafe-revert',
      `Revert all stopped because ${inspection.obstruction} obstructs a tracked path.`,
    )
  }

  const resetResult = await runGit(inspection.repositoryPath, ['reset', '--hard', 'HEAD'])
  if (resetResult.code !== 0) {
    return workingTreeFailure(
      'unknown',
      resetResult.stderr.trim() || 'Failed to restore tracked changes.',
    )
  }

  const cleanResult = await runGit(inspection.repositoryPath, ['clean', '-fd', '--', ':/'])
  if (cleanResult.code !== 0) {
    const detail = cleanResult.stderr.trim()
    return workingTreeFailure(
      'partial-revert',
      `Tracked changes were restored, but Git could not remove every untracked path${detail ? `: ${detail}` : '.'}`,
    )
  }

  return { ok: true, message: 'All eligible working-tree changes reverted.' }
}
