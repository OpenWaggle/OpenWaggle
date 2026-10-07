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

/**
 * A tracked path whose working-tree entry is a directory but whose restore target is a
 * file (a type change) can only be restored by `reset --hard` removing that directory
 * wholesale. `clean -fd` would retain ignored files and nested repositories beneath it,
 * but the reset deletes them regardless — breaking the retain promise. Refuse when the
 * directory holds any such retained content; plain untracked files are excluded because
 * revert-all deletes those anyway.
 */
async function directoryObstructsRestore(repositoryPath: string, gitPath: string) {
  const dir = `${gitPath}/`
  const ignored = await runGit(repositoryPath, [
    'ls-files',
    '-o',
    '-i',
    '-z',
    '--exclude-standard',
    '--',
    dir,
  ])
  if (ignored.code !== 0) return true
  if (nulSeparatedPaths(ignored.stdout).length > 0) return true

  const others = await runGit(repositoryPath, [
    'ls-files',
    '-o',
    '-z',
    '--exclude-standard',
    '--',
    dir,
  ])
  if (others.code !== 0) return true
  for (const entry of nulSeparatedPaths(others.stdout)) {
    // Git emits a trailing slash for directories it will not descend into, i.e. nested repos.
    if (!entry.endsWith('/')) continue
    if ((await pathExistsWithType(path.join(repositoryPath, entry, '.git'))) !== null) return true
  }
  return false
}

interface RestoreScanContext {
  repositoryPath: string
  indexPaths: ReadonlySet<string>
  submodulePaths: ReadonlySet<string>
}

type SegmentVerdict = 'obstruction' | 'stop' | 'descend'

async function classifyRestoreSegment(
  ctx: RestoreScanContext,
  gitPath: string,
  filePath: string,
  isDirectory: boolean,
  isHeadFile: boolean,
): Promise<SegmentVerdict> {
  // A tracked gitlink is a submodule: `reset --hard` (without --recurse-submodules)
  // leaves its working tree intact, so its inner `.git` is not an obstruction.
  if (ctx.submodulePaths.has(gitPath)) return 'stop'
  if (await isNestedRepository(filePath, isDirectory)) return 'obstruction'
  if (!isHeadFile) {
    if (isDirectory) return 'descend'
    return ctx.indexPaths.has(gitPath) ? 'stop' : 'obstruction'
  }
  if (!isDirectory) return ctx.indexPaths.has(gitPath) ? 'stop' : 'obstruction'
  if (!hasIndexedDescendant(ctx.indexPaths, gitPath)) return 'obstruction'
  return (await directoryObstructsRestore(ctx.repositoryPath, gitPath)) ? 'obstruction' : 'stop'
}

async function findTrackedRestoreObstruction(
  ctx: RestoreScanContext,
  trackedPaths: readonly string[],
) {
  for (const trackedPath of trackedPaths) {
    const segments = trackedPath.split('/')
    for (let segmentCount = 1; segmentCount <= segments.length; segmentCount += 1) {
      const gitPath = segments.slice(0, segmentCount).join('/')
      const filePath = path.join(ctx.repositoryPath, ...segments.slice(0, segmentCount))
      const file = await pathExistsWithType(filePath)
      if (!file) break
      const isHeadFile = segmentCount === segments.length
      const verdict = await classifyRestoreSegment(
        ctx,
        gitPath,
        filePath,
        file.isDirectory(),
        isHeadFile,
      )
      if (verdict === 'obstruction') return gitPath
      if (verdict === 'stop') break
    }
  }
  return null
}

function parseSubmodulePaths(stageStdout: string): ReadonlySet<string> {
  const submodulePaths = new Set<string>()
  for (const line of stageStdout.split('\0').filter(Boolean)) {
    // `ls-files --stage` lines are `<mode> <sha> <stage>\t<path>`; 160000 is a gitlink.
    if (!line.startsWith('160000 ')) continue
    const tabIndex = line.indexOf('\t')
    if (tabIndex >= 0) submodulePaths.add(line.slice(tabIndex + 1))
  }
  return submodulePaths
}

async function inspectTrackedRestore(projectPath: string) {
  const repositoryResult = await runGit(projectPath, ['rev-parse', '--show-toplevel'])
  if (repositoryResult.code !== 0) return null

  const repositoryPath = repositoryResult.stdout.replace(/\r?\n$/, '')
  const [headPathsResult, indexPathsResult, stageResult] = await Promise.all([
    runGit(repositoryPath, ['ls-tree', '-r', '-z', '--name-only', 'HEAD']),
    runGit(repositoryPath, ['ls-files', '-z']),
    runGit(repositoryPath, ['ls-files', '--stage', '-z']),
  ])
  if (headPathsResult.code !== 0 || indexPathsResult.code !== 0 || stageResult.code !== 0) {
    return null
  }

  const headPaths = nulSeparatedPaths(headPathsResult.stdout)
  const indexPaths = new Set(nulSeparatedPaths(indexPathsResult.stdout))
  const submodulePaths = parseSubmodulePaths(stageResult.stdout)

  return {
    repositoryPath,
    obstruction: await findTrackedRestoreObstruction(
      { repositoryPath, indexPaths, submodulePaths },
      [...new Set([...headPaths, ...indexPaths])],
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
