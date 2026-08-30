import type {
  LocalVcsStatus,
  LocalVcsStatusResult,
  RemoteVcsStatusResult,
  VcsChangeRequest,
} from '@shared/types/git'
import { networkGitOptions } from '../../adapters/git/run-git'
import { getSourceControlProvider } from '../../adapters/source-control'
import { resolveDefaultRef, resolveLocalDefaultRef } from './default-ref'
import { isGitRepository, runGit } from './shared'
import { GIT_PARSE_INT_RADIX, GIT_RAW_PATHS } from './status-constants'
import { buildChangedFiles, parseNumstat, parsePorcelain } from './status-parse'
import { detectSourceControlProvider, parseAheadBehind, toWorkingTree } from './vcs-status-parse'

/** The remote status is refreshed in the background, so a stalled remote must not pin it open. */
const REMOTE_FETCH_TIMEOUT_MS = 60_000

async function resolveRefName(projectPath: string): Promise<string | null> {
  const result = await runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (result.code !== 0) return null
  const name = result.stdout.trim()
  return name || null
}

export async function resolvePrimaryRemoteUrl(projectPath: string): Promise<string | null> {
  const originResult = await runGit(projectPath, ['remote', 'get-url', 'origin'])
  if (originResult.code === 0 && originResult.stdout.trim()) return originResult.stdout.trim()

  const listResult = await runGit(projectPath, ['remote'])
  if (listResult.code !== 0) return null
  const firstRemote = listResult.stdout.trim().split('\n')[0]?.trim()
  if (!firstRemote) return null
  const urlResult = await runGit(projectPath, ['remote', 'get-url', firstRemote])
  return urlResult.code === 0 ? urlResult.stdout.trim() || null : null
}

async function resolveWorkingTree(projectPath: string) {
  const [porcelainResult, worktreeNumstat, cachedNumstat] = await Promise.all([
    runGit(projectPath, [...GIT_RAW_PATHS, 'status', '--porcelain=v1']),
    runGit(projectPath, [...GIT_RAW_PATHS, 'diff', '--numstat']),
    runGit(projectPath, [...GIT_RAW_PATHS, 'diff', '--cached', '--numstat']),
  ])
  const numstat = parseNumstat(`${worktreeNumstat.stdout}\n${cachedNumstat.stdout}`)
  const changedFiles = buildChangedFiles(parsePorcelain(porcelainResult.stdout), numstat)
  return toWorkingTree(changedFiles)
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

  const [refName, remoteUrl, defaultRef, workingTree, upstreamBranch] = await Promise.all([
    resolveRefName(projectPath),
    resolvePrimaryRemoteUrl(projectPath),
    // Offline by contract: this status is cached with a two-second TTL and gates the quick action.
    resolveLocalDefaultRef(projectPath),
    resolveWorkingTree(projectPath),
    resolveUpstreamBranch(projectPath),
  ])
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
): Promise<number | null> {
  // The remote status may reach the network; the local one may not.
  const defaultRef = await resolveDefaultRef(projectPath)
  if (!defaultRef || !refName || refName === defaultRef) return null
  const result = await runGit(projectPath, ['rev-list', '--count', `origin/${defaultRef}..HEAD`])
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

  const upstreamResult = await runGit(projectPath, ['rev-parse', '--abbrev-ref', '@{upstream}'])
  const hasUpstream = upstreamResult.code === 0 && upstreamResult.stdout.trim().length > 0

  const aheadBehind = hasUpstream
    ? parseAheadBehind(
        (await runGit(projectPath, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']))
          .stdout,
      )
    : { ahead: 0, behind: 0 }

  const refName = await resolveRefName(projectPath)
  const [aheadOfDefaultCount, changeRequest] = await Promise.all([
    resolveAheadOfDefault(projectPath, refName),
    resolveOpenChangeRequest(projectPath, refName),
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
): Promise<VcsChangeRequest | null> {
  if (!refName) return null
  const remote = await runGit(projectPath, ['remote', 'get-url', 'origin'])
  const remoteUrl = remote.code === 0 ? remote.stdout.trim() || null : null
  const provider = getSourceControlProvider(detectSourceControlProvider(remoteUrl)?.id)
  if (!provider) return null
  const result = await provider.resolveChangeRequestForRef(projectPath, refName)
  return result.ok ? result.changeRequest : null
}
