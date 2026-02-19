import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  GitChangedFile,
  GitCommitFailure,
  GitCommitPayload,
  GitCommitResult,
  GitFileStatus,
  GitStatusSummary,
} from '@shared/types/git'
import { ipcMain } from 'electron'
import { z } from 'zod'

const execFileAsync = promisify(execFile)

interface GitExecResult {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
}

interface ParsedPorcelainEntry {
  readonly path: string
  readonly status: GitFileStatus
  readonly staged: boolean
}

function mapStatusCode(code: string): GitFileStatus {
  switch (code) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case '?':
      return 'untracked'
    default:
      return 'unknown'
  }
}

function parsePorcelain(stdout: string): ParsedPorcelainEntry[] {
  const entries: ParsedPorcelainEntry[] = []
  const lines = stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)

  for (const line of lines) {
    if (line.length < 3) continue
    const x = line[0] ?? ' '
    const y = line[1] ?? ' '
    const rawPath = line.slice(3).trim()
    const path = rawPath.includes(' -> ')
      ? (rawPath.split(' -> ').at(-1)?.trim() ?? rawPath)
      : rawPath

    const statusCode = x === '?' && y === '?' ? '?' : y !== ' ' ? y : x
    entries.push({
      path,
      status: mapStatusCode(statusCode),
      staged: x !== ' ' && x !== '?',
    })
  }

  return entries
}

function parseNumstat(stdout: string): Map<string, { additions: number; deletions: number }> {
  const result = new Map<string, { additions: number; deletions: number }>()
  const lines = stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)

  for (const line of lines) {
    const parts = line.split('\t')
    if (parts.length < 3) continue

    const additions = Number.parseInt(parts[0] ?? '0', 10)
    const deletions = Number.parseInt(parts[1] ?? '0', 10)
    const path = parts.slice(2).pop()?.trim()
    if (!path) continue

    const safeAdditions = Number.isFinite(additions) ? additions : 0
    const safeDeletions = Number.isFinite(deletions) ? deletions : 0
    result.set(path, { additions: safeAdditions, deletions: safeDeletions })
  }

  return result
}

async function runGit(projectPath: string, args: string[]): Promise<GitExecResult> {
  try {
    const output = await execFileAsync('git', args, {
      cwd: projectPath,
      maxBuffer: 5 * 1024 * 1024,
    })
    if (typeof output === 'string') {
      return { stdout: output, stderr: '', code: 0 }
    }
    return {
      stdout: output.stdout ?? '',
      stderr: output.stderr ?? '',
      code: 0,
    }
  } catch (err) {
    const error = err as {
      stdout?: string
      stderr?: string
      code?: number
      message?: string
    }
    return {
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? error.message ?? 'Git command failed',
      code: typeof error.code === 'number' ? error.code : 1,
    }
  }
}

async function isGitRepository(projectPath: string): Promise<boolean> {
  const result = await runGit(projectPath, ['rev-parse', '--is-inside-work-tree'])
  return result.code === 0 && result.stdout.trim() === 'true'
}

function commitFailure(code: GitCommitFailure['code'], message: string): GitCommitFailure {
  return { ok: false, code, message }
}

function mapCommitFailure(stderr: string): GitCommitFailure {
  const message = stderr.trim()
  const lower = message.toLowerCase()

  if (lower.includes('not a git repository')) {
    return commitFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }
  if (
    lower.includes('nothing to commit') ||
    lower.includes('no changes added to commit') ||
    lower.includes('nothing added to commit')
  ) {
    return commitFailure('nothing-to-commit', 'No changes available to commit.')
  }
  if (lower.includes('merge_head exists') || lower.includes('you have not concluded your merge')) {
    return commitFailure('merge-in-progress', 'Resolve the merge in progress before committing.')
  }

  return commitFailure('unknown', message || 'Git commit failed.')
}

async function getGitStatus(projectPath: string): Promise<GitStatusSummary> {
  if (!(await isGitRepository(projectPath))) {
    throw new Error('Selected folder is not a Git repository.')
  }

  const [branchResult, porcelainResult, numstatHeadResult, upstreamResult] = await Promise.all([
    runGit(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(projectPath, ['status', '--porcelain=v1']),
    runGit(projectPath, ['diff', '--numstat', 'HEAD']),
    runGit(projectPath, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']),
  ])

  let branch = branchResult.stdout.trim() || 'unknown'
  if (branch === 'HEAD') {
    const hashResult = await runGit(projectPath, ['rev-parse', '--short', 'HEAD'])
    if (hashResult.code === 0) {
      branch = `detached@${hashResult.stdout.trim()}`
    }
  }

  let ahead = 0
  let behind = 0
  if (upstreamResult.code === 0) {
    // git rev-list --left-right --count outputs: <ahead>\t<behind>
    const [aheadStr, behindStr] = upstreamResult.stdout.trim().split('\t')
    ahead = Number.parseInt(aheadStr ?? '0', 10) || 0
    behind = Number.parseInt(behindStr ?? '0', 10) || 0
  }

  const porcelainEntries = parsePorcelain(porcelainResult.stdout)

  let numstat = parseNumstat(numstatHeadResult.stdout)
  if (numstatHeadResult.code !== 0) {
    const [worktreeResult, cachedResult] = await Promise.all([
      runGit(projectPath, ['diff', '--numstat']),
      runGit(projectPath, ['diff', '--cached', '--numstat']),
    ])
    numstat = parseNumstat(`${worktreeResult.stdout}\n${cachedResult.stdout}`)
  }
  const byPath = new Map<string, ParsedPorcelainEntry>()
  for (const entry of porcelainEntries) {
    byPath.set(entry.path, entry)
  }

  // Include files that appear in numstat but not in porcelain snapshots.
  for (const path of numstat.keys()) {
    if (!byPath.has(path)) {
      byPath.set(path, { path, status: 'modified', staged: false })
    }
  }

  const changedFiles: GitChangedFile[] = [...byPath.values()]
    .map((entry) => {
      const lineStats = numstat.get(entry.path)
      return {
        path: entry.path,
        status: entry.status,
        staged: entry.staged,
        additions: lineStats?.additions ?? 0,
        deletions: lineStats?.deletions ?? 0,
      } satisfies GitChangedFile
    })
    .sort((a, b) => a.path.localeCompare(b.path))

  const additions = changedFiles.reduce((sum, file) => sum + file.additions, 0)
  const deletions = changedFiles.reduce((sum, file) => sum + file.deletions, 0)

  return {
    branch,
    additions,
    deletions,
    filesChanged: changedFiles.length,
    changedFiles,
    clean: changedFiles.length === 0,
    ahead,
    behind,
  }
}

async function commitGit(projectPath: string, payload: GitCommitPayload): Promise<GitCommitResult> {
  const message = payload.message.trim()
  if (!message) {
    return commitFailure('empty-message', 'Commit message is required.')
  }
  if (!(await isGitRepository(projectPath))) {
    return commitFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }

  const mergeCheck = await runGit(projectPath, ['rev-parse', '-q', '--verify', 'MERGE_HEAD'])
  if (mergeCheck.code === 0) {
    return commitFailure('merge-in-progress', 'Resolve the merge in progress before committing.')
  }

  // Stage only the files explicitly selected by the user.
  if (payload.paths.length > 0) {
    const addResult = await runGit(projectPath, ['add', '--', ...payload.paths])
    if (addResult.code !== 0) {
      return mapCommitFailure(addResult.stderr)
    }
  }

  const commitArgs = ['commit', '-m', message]
  if (payload.amend) {
    commitArgs.push('--amend')
  }

  const commitResult = await runGit(projectPath, commitArgs)
  if (commitResult.code !== 0) {
    return mapCommitFailure(`${commitResult.stderr}\n${commitResult.stdout}`)
  }

  const hashResult = await runGit(projectPath, ['rev-parse', 'HEAD'])
  const commitHash = hashResult.code === 0 ? hashResult.stdout.trim() : ''
  const summary = commitResult.stdout.trim().split('\n')[0] ?? 'Commit created.'

  return {
    ok: true,
    commitHash,
    summary,
  }
}

const projectPathSchema = z
  .string()
  .min(1)
  .refine((p) => path.isAbsolute(p), { message: 'Project path must be absolute' })

const commitPayloadSchema = z.object({
  message: z.string(),
  amend: z.boolean(),
  paths: z.array(z.string()),
})

export function registerGitHandlers(): void {
  ipcMain.handle('git:status', async (_event, rawPath: unknown) => {
    const projectPath = projectPathSchema.parse(rawPath)
    return getGitStatus(projectPath)
  })

  ipcMain.handle('git:commit', async (_event, rawPath: unknown, rawPayload: unknown) => {
    const projectPath = projectPathSchema.parse(rawPath)
    const payload = commitPayloadSchema.parse(rawPayload)
    return commitGit(projectPath, payload)
  })
}
