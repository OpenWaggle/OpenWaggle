import type {
  LocalVcsStatus,
  LocalVcsStatusResult,
  RemoteVcsStatusResult,
  VcsChangeRequest,
  VcsWorkingTree,
} from '@shared/types/git'
import { networkGitOptions } from '../../adapters/git/run-git'
import { getSourceControlProvider } from '../../adapters/source-control'
import { resolveDefaultRef, resolveLocalDefaultRef } from './default-ref'
import {
  type PrimaryRemote,
  resolvePrimaryRemote,
  resolvePrimaryRemoteResult,
} from './primary-remote'
import { isGitRepository, runGit } from './shared'
import { GIT_PARSE_INT_RADIX, GIT_RAW_PATHS } from './status-constants'
import { buildChangedFiles, parseNumstat, parsePorcelain } from './status-parse'
import { detectSourceControlProvider, parseAheadBehind, toWorkingTree } from './vcs-status-parse'

/** The remote status is refreshed in the background, so a stalled remote must not pin it open. */
const REMOTE_FETCH_TIMEOUT_MS = 60_000

type LocalReadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string }

function localReadFailure(label: string, stderr: string) {
  const detail = stderr.trim()
  return detail ? `Could not read ${label}: ${detail}` : `Could not read ${label}.`
}

async function resolveRefNameResult(projectPath: string): Promise<LocalReadResult<string | null>> {
  const result = await runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  // `symbolic-ref --quiet` exits non-zero without stderr for a genuine detached HEAD. An execution
  // failure has a diagnostic; accepting that as detached silently enabled the wrong Git workflow.
  if (result.code !== 0) {
    return result.executionFailed === true || result.stderr.trim()
      ? { ok: false, message: localReadFailure('the current Git branch', result.stderr) }
      : { ok: true, value: null }
  }
  const name = result.stdout.trim()
  return { ok: true, value: name || null }
}

async function resolveRefName(projectPath: string): Promise<string | null> {
  const result = await resolveRefNameResult(projectPath)
  return result.ok ? result.value : null
}

export { resolvePrimaryRemote, resolvePrimaryRemoteUrl } from './primary-remote'

async function resolveWorkingTree(projectPath: string): Promise<LocalReadResult<VcsWorkingTree>> {
  const [porcelainResult, worktreeNumstat, cachedNumstat] = await Promise.all([
    runGit(projectPath, [...GIT_RAW_PATHS, 'status', '--porcelain=v1']),
    runGit(projectPath, [...GIT_RAW_PATHS, 'diff', '--numstat']),
    runGit(projectPath, [...GIT_RAW_PATHS, 'diff', '--cached', '--numstat']),
  ])
  const failed = [porcelainResult, worktreeNumstat, cachedNumstat].find(
    (result) => result.code !== 0,
  )
  if (failed) {
    return { ok: false, message: localReadFailure('the Git working tree', failed.stderr) }
  }
  const numstat = parseNumstat(`${worktreeNumstat.stdout}\n${cachedNumstat.stdout}`)
  const changedFiles = buildChangedFiles(parsePorcelain(porcelainResult.stdout), numstat)
  return { ok: true, value: toWorkingTree(changedFiles) }
}

/**
 * The branch an upstream-tracking push would update, without its remote prefix.
 *
 * `@{upstream}` is `origin/main` for a branch tracking main, and a push follows that mapping however the branch
 * is named locally - so this, not the current ref, is what a push writes.
 */
async function resolveUpstreamBranch(projectPath: string): Promise<string | null> {
  const upstream = await runGit(projectPath, ['rev-parse', '--abbrev-ref', '@{upstream}'])
  if (upstream.code !== 0) return null
  const value = upstream.stdout.trim()
  if (value.length === 0) return null
  const separator = value.indexOf('/')
  return separator === -1 ? value : value.slice(separator + 1)
}

export async function getLocalVcsStatus(projectPath: string): Promise<LocalVcsStatusResult> {
  if (!(await isGitRepository(projectPath))) {
    return { ok: false, code: 'not-a-repo', message: 'Selected folder is not a Git repository.' }
  }

  const [refNameResult, primaryRemoteResult, workingTreeResult, upstreamBranch] = await Promise.all(
    [
      resolveRefNameResult(projectPath),
      resolvePrimaryRemoteResult(projectPath),
      resolveWorkingTree(projectPath),
      resolveUpstreamBranch(projectPath),
    ],
  )
  if (!refNameResult.ok) return { ok: false, code: 'unknown', message: refNameResult.message }
  if (!primaryRemoteResult.ok) {
    return { ok: false, code: 'unknown', message: primaryRemoteResult.message }
  }
  if (!workingTreeResult.ok) {
    return { ok: false, code: 'unknown', message: workingTreeResult.message }
  }
  const refName = refNameResult.value
  const primaryRemote = primaryRemoteResult.remote
  const workingTree = workingTreeResult.value
  // Offline by contract: this status is cached with a two-second TTL and gates the quick action.
  const defaultRef = await resolveLocalDefaultRef(projectPath, primaryRemote?.name ?? 'origin')
  const remoteUrl = primaryRemote?.url ?? null
  // What a push would write, which is the upstream's branch when one is set - not necessarily this one.
  const pushTargetRef = upstreamBranch ?? refName

  const status: LocalVcsStatus = {
    isRepo: true,
    sourceControlProvider: detectSourceControlProvider(remoteUrl),
    hasPrimaryRemote: remoteUrl !== null,
    defaultRef,
    /*
     * Unknown counts as "yes", so the confirmation that guards a push to the default branch fails closed.
     * `refs/remotes/origin/HEAD` is what records the default branch locally, and `git clone` writes it while
     * `git init` plus `git remote add` does not - verified. In such a repository the default branch resolved to
     * nothing, this read false, and a one-click Commit & push reached the default branch with no confirmation
     * at all. Asking once too often is the harmless direction.
     */
    isDefaultRef: refName !== null && (defaultRef === null || refName === defaultRef),
    pushTargetRef,
    pushTargetIsDefaultRef:
      pushTargetRef !== null && (defaultRef === null || pushTargetRef === defaultRef),
    refName,
    hasWorkingTreeChanges: workingTree.files.length > 0,
    workingTree,
  }
  return { ok: true, status }
}

async function resolveAheadOfDefault(
  projectPath: string,
  refName: string | null,
  remoteName: string,
): Promise<number | null> {
  // The remote status may reach the network; the local one may not.
  const defaultRef = await resolveDefaultRef(projectPath, remoteName)
  if (!defaultRef || !refName || refName === defaultRef) return null
  const result = await runGit(projectPath, [
    'rev-list',
    '--count',
    `${remoteName}/${defaultRef}..HEAD`,
  ])
  if (result.code !== 0) return null
  const parsed = Number.parseInt(result.stdout.trim(), GIT_PARSE_INT_RADIX)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export async function getRemoteVcsStatus(projectPath: string): Promise<RemoteVcsStatusResult> {
  if (!(await isGitRepository(projectPath))) {
    return { ok: false, code: 'not-a-repo', message: 'Selected folder is not a Git repository.' }
  }

  const fetchResult = await runGit(
    projectPath,
    ['fetch', '--quiet'],
    networkGitOptions(REMOTE_FETCH_TIMEOUT_MS),
  )
  if (fetchResult.code !== 0) {
    return {
      ok: false,
      code: 'remote-unreachable',
      message: fetchResult.stderr.trim() || 'Failed to reach the remote.',
    }
  }

  const [upstreamResult, primaryRemote] = await Promise.all([
    runGit(projectPath, ['rev-parse', '--abbrev-ref', '@{upstream}']),
    resolvePrimaryRemote(projectPath),
  ])
  const hasUpstream = upstreamResult.code === 0 && upstreamResult.stdout.trim().length > 0

  const aheadBehind = hasUpstream
    ? parseAheadBehind(
        (await runGit(projectPath, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']))
          .stdout,
      )
    : { ahead: 0, behind: 0 }

  const refName = await resolveRefName(projectPath)
  const [aheadOfDefaultCount, changeRequest] = await Promise.all([
    resolveAheadOfDefault(projectPath, refName, primaryRemote?.name ?? 'origin'),
    resolveOpenChangeRequest(projectPath, refName, primaryRemote),
  ])

  return {
    ok: true,
    status: {
      hasUpstream,
      aheadCount: aheadBehind.ahead,
      behindCount: aheadBehind.behind,
      aheadOfDefaultCount,
      changeRequest,
    },
  }
}

/**
 * Open change request for the current ref via the source-control provider (WS3).
 * Never fails the whole remote status: any provider/CLI/auth failure maps to null.
 */
async function resolveOpenChangeRequest(
  projectPath: string,
  refName: string | null,
  primaryRemote: PrimaryRemote | null,
): Promise<VcsChangeRequest | null> {
  if (!refName) return null
  const provider = getSourceControlProvider(detectSourceControlProvider(primaryRemote?.url)?.id)
  if (!provider) return null
  const result = await provider.resolveChangeRequestForRef(projectPath, refName)
  return result.ok ? result.changeRequest : null
}
