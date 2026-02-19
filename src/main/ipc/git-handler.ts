import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  GitBranchCheckoutPayload,
  GitBranchCreatePayload,
  GitBranchDeletePayload,
  GitBranchInfo,
  GitBranchListResult,
  GitBranchMutationFailure,
  GitBranchMutationResult,
  GitBranchRenamePayload,
  GitBranchSetUpstreamPayload,
  GitChangedFile,
  GitCommitFailure,
  GitCommitPayload,
  GitCommitResult,
  GitFileDiff,
  GitFileStatus,
  GitStatusSummary,
} from '@shared/types/git'
import { ipcMain } from 'electron'
import { z } from 'zod'

const execFileAsync = promisify(execFile)
const DEFAULT_GIT_MAX_BUFFER = 5 * 1024 * 1024
const DIFF_GIT_MAX_BUFFER = 32 * 1024 * 1024

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

interface RunGitOptions {
  readonly maxBuffer?: number
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

async function runGit(
  projectPath: string,
  args: string[],
  options: RunGitOptions = {},
): Promise<GitExecResult> {
  const maxBuffer = options.maxBuffer ?? DEFAULT_GIT_MAX_BUFFER
  try {
    const output = await execFileAsync('git', args, {
      cwd: projectPath,
      maxBuffer,
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

function parseUnifiedDiff(stdout: string): GitFileDiff[] {
  const files: GitFileDiff[] = []
  // Split on "diff --git" boundaries
  const chunks = stdout.split(/^diff --git /m).filter(Boolean)

  for (const chunk of chunks) {
    const lines = chunk.split('\n')
    // Extract file path from "a/path b/path" header
    const header = lines[0] ?? ''
    const bMatch = / b\/(.+)$/.exec(header)
    const filePath = bMatch?.[1] ?? header.trim()

    let additions = 0
    let deletions = 0

    for (const line of lines.slice(1)) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++
      }
    }

    if (filePath) {
      files.push({
        path: filePath,
        diff: `diff --git ${chunk}`,
        additions,
        deletions,
      })
    }
  }

  return files
}

function mergeDiffsByPath(diffs: GitFileDiff[]): GitFileDiff[] {
  const merged = new Map<string, GitFileDiff>()

  for (const diff of diffs) {
    const existing = merged.get(diff.path)
    if (!existing) {
      merged.set(diff.path, diff)
      continue
    }

    merged.set(diff.path, {
      path: diff.path,
      diff: `${existing.diff}\n${diff.diff}`,
      additions: existing.additions + diff.additions,
      deletions: existing.deletions + diff.deletions,
    })
  }

  return [...merged.values()].sort((a, b) => a.path.localeCompare(b.path))
}

async function getGitDiff(projectPath: string): Promise<GitFileDiff[]> {
  if (!(await isGitRepository(projectPath))) {
    throw new Error('Selected folder is not a Git repository.')
  }

  const hasHead = await runGit(projectPath, ['rev-parse', '--verify', 'HEAD'])

  // Single-pass diff for normal repositories.
  if (hasHead.code === 0) {
    const headResult = await runGit(
      projectPath,
      ['diff', '--patch', '--find-renames', '--no-ext-diff', 'HEAD'],
      { maxBuffer: DIFF_GIT_MAX_BUFFER },
    )
    if (headResult.code !== 0) {
      throw new Error(headResult.stderr.trim() || 'Failed to load Git diff.')
    }
    if (!headResult.stdout.trim()) return []
    return parseUnifiedDiff(headResult.stdout)
  }

  // Initial commit path: combine unstaged + staged and merge by file path.
  const [worktreeResult, cachedResult] = await Promise.all([
    runGit(projectPath, ['diff', '--patch', '--no-ext-diff'], { maxBuffer: DIFF_GIT_MAX_BUFFER }),
    runGit(projectPath, ['diff', '--patch', '--cached', '--no-ext-diff'], {
      maxBuffer: DIFF_GIT_MAX_BUFFER,
    }),
  ])

  if (worktreeResult.code !== 0 && cachedResult.code !== 0) {
    throw new Error(
      worktreeResult.stderr.trim() || cachedResult.stderr.trim() || 'Failed to load Git diff.',
    )
  }

  const parsed = [
    ...parseUnifiedDiff(worktreeResult.stdout),
    ...parseUnifiedDiff(cachedResult.stdout),
  ]
  if (parsed.length === 0) return []
  return mergeDiffsByPath(parsed)
}

function parseTrackCounts(track: string): { ahead: number; behind: number } {
  const aheadMatch = /ahead (\d+)/.exec(track)
  const behindMatch = /behind (\d+)/.exec(track)
  return {
    ahead: aheadMatch ? Number.parseInt(aheadMatch[1] ?? '0', 10) || 0 : 0,
    behind: behindMatch ? Number.parseInt(behindMatch[1] ?? '0', 10) || 0 : 0,
  }
}

function branchFailure(
  code: GitBranchMutationFailure['code'],
  message: string,
): GitBranchMutationFailure {
  return { ok: false, code, message }
}

function mapBranchFailure(stderr: string): GitBranchMutationFailure {
  const message = stderr.trim()
  const lower = message.toLowerCase()

  if (lower.includes('not a git repository')) {
    return branchFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }
  if (
    lower.includes('did not match any file') ||
    lower.includes('unknown revision') ||
    lower.includes("isn't a commit") ||
    lower.includes('not found')
  ) {
    return branchFailure('branch-not-found', 'The requested branch could not be found.')
  }
  if (lower.includes('already exists')) {
    return branchFailure('branch-exists', 'A branch with this name already exists.')
  }
  if (
    lower.includes('local changes') ||
    lower.includes('would be overwritten by checkout') ||
    lower.includes('please commit your changes or stash')
  ) {
    return branchFailure(
      'dirty-worktree',
      'Commit or stash local changes before switching branches.',
    )
  }
  if (
    lower.includes('is not a valid branch name') ||
    lower.includes('not a valid object name') ||
    lower.includes('invalid refspec') ||
    lower.includes('invalid branch name')
  ) {
    return branchFailure('invalid-name', 'Branch name is invalid.')
  }
  if (lower.includes('upstream branch') && lower.includes('does not exist')) {
    return branchFailure('upstream-not-found', 'The selected upstream branch does not exist.')
  }

  return branchFailure('unknown', message || 'Git branch operation failed.')
}

async function listGitBranches(projectPath: string): Promise<GitBranchListResult> {
  if (!(await isGitRepository(projectPath))) {
    throw new Error('Selected folder is not a Git repository.')
  }

  const currentResult = await runGit(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const currentBranchRaw = currentResult.code === 0 ? currentResult.stdout.trim() : ''
  const currentBranch = currentBranchRaw && currentBranchRaw !== 'HEAD' ? currentBranchRaw : null

  const refsResult = await runGit(projectPath, [
    'for-each-ref',
    '--format=%(refname)%09%(refname:short)%09%(upstream:short)%09%(HEAD)%09%(upstream:track)',
    'refs/heads',
    'refs/remotes',
  ])
  if (refsResult.code !== 0) {
    throw new Error(refsResult.stderr.trim() || 'Failed to load Git branches.')
  }

  const branches: GitBranchInfo[] = refsResult.stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [fullName = '', shortName = '', upstream = '', headMark = '', track = ''] =
        line.split('\t')
      const { ahead, behind } = parseTrackCounts(track)

      return {
        fullName,
        name: shortName,
        isRemote: fullName.startsWith('refs/remotes/'),
        isCurrent: headMark.trim() === '*',
        upstream: upstream || null,
        ahead,
        behind,
      } satisfies GitBranchInfo
    })
    .filter((entry) => !entry.name.endsWith('/HEAD'))
    .sort((a, b) => {
      if (a.isRemote !== b.isRemote) {
        return a.isRemote ? 1 : -1
      }
      return a.name.localeCompare(b.name)
    })

  return {
    currentBranch,
    branches,
  }
}

async function checkoutGitBranch(
  projectPath: string,
  payload: GitBranchCheckoutPayload,
): Promise<GitBranchMutationResult> {
  const name = payload.name.trim()
  if (!name) {
    return branchFailure('invalid-name', 'Branch name is required.')
  }
  if (!(await isGitRepository(projectPath))) {
    return branchFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }

  // If selecting a remote ref (e.g. origin/feature), prefer checking out
  // the corresponding local tracking branch instead of detached HEAD.
  const remoteRefResult = await runGit(projectPath, [
    'show-ref',
    '--verify',
    '--quiet',
    `refs/remotes/${name}`,
  ])
  if (remoteRefResult.code === 0) {
    const localName = name.split('/').slice(1).join('/')
    if (localName) {
      const localExistsResult = await runGit(projectPath, [
        'show-ref',
        '--verify',
        '--quiet',
        `refs/heads/${localName}`,
      ])
      if (localExistsResult.code === 0) {
        const upstreamResult = await runGit(projectPath, [
          'for-each-ref',
          '--format=%(upstream:short)',
          `refs/heads/${localName}`,
        ])
        const upstream = upstreamResult.code === 0 ? upstreamResult.stdout.trim() : ''
        if (upstream === name) {
          const checkoutLocalResult = await runGit(projectPath, ['checkout', localName])
          if (checkoutLocalResult.code !== 0) {
            return mapBranchFailure(`${checkoutLocalResult.stderr}\n${checkoutLocalResult.stdout}`)
          }
          return { ok: true, message: `Switched to ${localName}.` }
        }
        return branchFailure(
          'branch-exists',
          `Local branch "${localName}" already exists and is not tracking "${name}".`,
        )
      }
    }

    const trackResult = await runGit(projectPath, ['checkout', '--track', name])
    if (trackResult.code !== 0) {
      return mapBranchFailure(`${trackResult.stderr}\n${trackResult.stdout}`)
    }
    return { ok: true, message: `Switched to tracking branch ${name}.` }
  }

  const result = await runGit(projectPath, ['checkout', name])
  if (result.code !== 0) {
    return mapBranchFailure(`${result.stderr}\n${result.stdout}`)
  }

  return { ok: true, message: `Switched to ${name}.` }
}

async function createGitBranch(
  projectPath: string,
  payload: GitBranchCreatePayload,
): Promise<GitBranchMutationResult> {
  const name = payload.name.trim()
  if (!name) {
    return branchFailure('invalid-name', 'Branch name is required.')
  }
  if (!(await isGitRepository(projectPath))) {
    return branchFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }

  const validateResult = await runGit(projectPath, ['check-ref-format', '--branch', name])
  if (validateResult.code !== 0) {
    return branchFailure('invalid-name', 'Branch name is invalid.')
  }

  const existingResult = await runGit(projectPath, [
    'show-ref',
    '--verify',
    '--quiet',
    `refs/heads/${name}`,
  ])
  if (existingResult.code === 0) {
    return branchFailure('branch-exists', 'A branch with this name already exists.')
  }

  const createArgs = ['branch', name]
  if (payload.startPoint?.trim()) {
    createArgs.push(payload.startPoint.trim())
  }
  const createResult = await runGit(projectPath, createArgs)
  if (createResult.code !== 0) {
    return mapBranchFailure(`${createResult.stderr}\n${createResult.stdout}`)
  }

  if (payload.checkout) {
    const checkoutResult = await runGit(projectPath, ['checkout', name])
    if (checkoutResult.code !== 0) {
      return mapBranchFailure(`${checkoutResult.stderr}\n${checkoutResult.stdout}`)
    }
  }

  return {
    ok: true,
    message: payload.checkout ? `Created and checked out ${name}.` : `Created ${name}.`,
  }
}

async function renameGitBranch(
  projectPath: string,
  payload: GitBranchRenamePayload,
): Promise<GitBranchMutationResult> {
  const from = payload.from.trim()
  const to = payload.to.trim()
  if (!from || !to) {
    return branchFailure('invalid-name', 'Both source and target branch names are required.')
  }
  if (!(await isGitRepository(projectPath))) {
    return branchFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }

  const result = await runGit(projectPath, ['branch', '-m', from, to])
  if (result.code !== 0) {
    return mapBranchFailure(`${result.stderr}\n${result.stdout}`)
  }

  return { ok: true, message: `Renamed ${from} to ${to}.` }
}

async function deleteGitBranch(
  projectPath: string,
  payload: GitBranchDeletePayload,
): Promise<GitBranchMutationResult> {
  const name = payload.name.trim()
  if (!name) {
    return branchFailure('invalid-name', 'Branch name is required.')
  }
  if (!(await isGitRepository(projectPath))) {
    return branchFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }

  const result = await runGit(projectPath, ['branch', payload.force ? '-D' : '-d', name])
  if (result.code !== 0) {
    return mapBranchFailure(`${result.stderr}\n${result.stdout}`)
  }

  return { ok: true, message: `Deleted ${name}.` }
}

async function setGitBranchUpstream(
  projectPath: string,
  payload: GitBranchSetUpstreamPayload,
): Promise<GitBranchMutationResult> {
  const name = payload.name.trim()
  const upstream = payload.upstream.trim()
  if (!name || !upstream) {
    return branchFailure('invalid-name', 'Branch and upstream are required.')
  }
  if (!(await isGitRepository(projectPath))) {
    return branchFailure('not-git-repo', 'Selected folder is not a Git repository.')
  }

  const result = await runGit(projectPath, ['branch', '--set-upstream-to', upstream, name])
  if (result.code !== 0) {
    return mapBranchFailure(`${result.stderr}\n${result.stdout}`)
  }

  return { ok: true, message: `Set upstream for ${name} to ${upstream}.` }
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

const branchCheckoutPayloadSchema = z.object({
  name: z.string(),
})

const branchCreatePayloadSchema = z.object({
  name: z.string(),
  startPoint: z.string().optional(),
  checkout: z.boolean().optional(),
})

const branchRenamePayloadSchema = z.object({
  from: z.string(),
  to: z.string(),
})

const branchDeletePayloadSchema = z.object({
  name: z.string(),
  force: z.boolean().optional(),
})

const branchSetUpstreamPayloadSchema = z.object({
  name: z.string(),
  upstream: z.string(),
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

  ipcMain.handle('git:diff', async (_event, rawPath: unknown) => {
    const projectPath = projectPathSchema.parse(rawPath)
    return getGitDiff(projectPath)
  })

  ipcMain.handle('git:branches:list', async (_event, rawPath: unknown) => {
    const projectPath = projectPathSchema.parse(rawPath)
    return listGitBranches(projectPath)
  })

  ipcMain.handle('git:branches:checkout', async (_event, rawPath: unknown, rawPayload: unknown) => {
    const projectPath = projectPathSchema.parse(rawPath)
    const payload = branchCheckoutPayloadSchema.parse(rawPayload)
    return checkoutGitBranch(projectPath, payload)
  })

  ipcMain.handle('git:branches:create', async (_event, rawPath: unknown, rawPayload: unknown) => {
    const projectPath = projectPathSchema.parse(rawPath)
    const payload = branchCreatePayloadSchema.parse(rawPayload)
    return createGitBranch(projectPath, payload)
  })

  ipcMain.handle('git:branches:rename', async (_event, rawPath: unknown, rawPayload: unknown) => {
    const projectPath = projectPathSchema.parse(rawPath)
    const payload = branchRenamePayloadSchema.parse(rawPayload)
    return renameGitBranch(projectPath, payload)
  })

  ipcMain.handle('git:branches:delete', async (_event, rawPath: unknown, rawPayload: unknown) => {
    const projectPath = projectPathSchema.parse(rawPath)
    const payload = branchDeletePayloadSchema.parse(rawPayload)
    return deleteGitBranch(projectPath, payload)
  })

  ipcMain.handle(
    'git:branches:set-upstream',
    async (_event, rawPath: unknown, rawPayload: unknown) => {
      const projectPath = projectPathSchema.parse(rawPath)
      const payload = branchSetUpstreamPayloadSchema.parse(rawPayload)
      return setGitBranchUpstream(projectPath, payload)
    },
  )
}
