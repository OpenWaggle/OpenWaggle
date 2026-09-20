import type {
  LocalVcsStatus,
  LocalVcsStatusResult,
  RemoteVcsStatusResult,
  VcsChangeRequest,
  VcsWorkingTree,
} from '@shared/types/git'
import { networkGitOptions } from '../../adapters/git/run-git'
import { getSourceControlProvider } from '../../adapters/source-control'
import { runWithGitNetworkLock } from '../../services/git/mutation-lock'
import { resolveDefaultRef } from './default-ref'
import {
  type PrimaryRemote,
  resolvePrimaryRemote,
  resolvePrimaryRemoteResult,
} from './primary-remote'
import { runGit } from './shared'
import { GIT_PARSE_INT_RADIX, GIT_RAW_PATHS } from './status-constants'
import { buildChangedFiles, parseNumstat, parsePorcelain } from './status-parse'
import { resolveLocalPushStatus } from './vcs-local-push-destination'
import {
  detectSourceControlProvider,
  parseAheadBehind,
  parseRemoteRepositoryIdentity,
  toWorkingTree,
} from './vcs-status-parse'

/** The remote status is refreshed in the background, so a stalled remote must not pin it open. */
const REMOTE_FETCH_TIMEOUT_MS = 60_000

type LocalReadResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string }

function localReadFailure(label: string, stderr: string) {
  const detail = stderr.trim()
  return detail ? `Could not read ${label}: ${detail}` : `Could not read ${label}.`
}

async function repositoryProbeFailure(projectPath: string) {
  const result = await runGit(projectPath, ['rev-parse', '--is-inside-work-tree'])
  if (result.executionFailed) {
    const detail = result.stderr.trim()
    return {
      ok: false,
      code: 'unknown',
      message: detail
        ? `Could not inspect the Git repository: ${detail}`
        : 'Could not inspect the Git repository.',
    } as const
  }
  if (result.code !== 0 || result.stdout.trim() !== 'true') {
    return {
      ok: false,
      code: 'not-a-repo',
      message: 'Selected folder is not a Git repository.',
    } as const
  }
  return null
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
    runGit(projectPath, [...GIT_RAW_PATHS, 'status', '--porcelain=v1', '-z']),
    runGit(projectPath, [...GIT_RAW_PATHS, 'diff', '--numstat', '-z']),
    runGit(projectPath, [...GIT_RAW_PATHS, 'diff', '--cached', '--numstat', '-z']),
  ])
  const failed = [porcelainResult, worktreeNumstat, cachedNumstat].find(
    (result) => result.code !== 0,
  )
  if (failed) {
    return { ok: false, message: localReadFailure('the Git working tree', failed.stderr) }
  }
  const numstat = parseNumstat(`${worktreeNumstat.stdout}${cachedNumstat.stdout}`)
  const changedFiles = buildChangedFiles(parsePorcelain(porcelainResult.stdout), numstat)
  return { ok: true, value: toWorkingTree(changedFiles) }
}

export async function getLocalVcsStatus(
  projectPath: string,
  options: { readonly resolvePushDestination?: boolean } = {},
): Promise<LocalVcsStatusResult> {
  const probeFailure = await repositoryProbeFailure(projectPath)
  if (probeFailure) return probeFailure

  const [refNameResult, primaryRemoteResult, workingTreeResult] = await Promise.all([
    resolveRefNameResult(projectPath),
    resolvePrimaryRemoteResult(projectPath),
    resolveWorkingTree(projectPath),
  ])
  const inputs = resolveLocalStatusInputs(refNameResult, primaryRemoteResult, workingTreeResult)
  return inputs.ok
    ? buildLocalVcsStatus(
        projectPath,
        inputs.refName,
        inputs.primaryRemote,
        inputs.workingTree,
        options.resolvePushDestination !== false,
      )
    : { ok: false, code: 'unknown', message: inputs.message }
}

function resolveLocalStatusInputs(
  refName: Awaited<ReturnType<typeof resolveRefNameResult>>,
  primaryRemote: Awaited<ReturnType<typeof resolvePrimaryRemoteResult>>,
  workingTree: Awaited<ReturnType<typeof resolveWorkingTree>>,
) {
  if (!refName.ok) return { ok: false as const, message: refName.message }
  if (!primaryRemote.ok) return { ok: false as const, message: primaryRemote.message }
  if (!workingTree.ok) return { ok: false as const, message: workingTree.message }
  return {
    ok: true as const,
    refName: refName.value,
    primaryRemote: primaryRemote.remote,
    workingTree: workingTree.value,
  }
}

async function buildLocalVcsStatus(
  projectPath: string,
  refName: string | null,
  primaryRemote: PrimaryRemote | null,
  workingTree: VcsWorkingTree,
  shouldResolvePushDestination: boolean,
): Promise<LocalVcsStatusResult> {
  const push = await resolveLocalPushStatus(
    projectPath,
    refName,
    primaryRemote,
    shouldResolvePushDestination,
  )
  if (!push.ok) return { ok: false, code: 'unknown', message: push.message }
  const remoteUrl = primaryRemote?.url ?? null

  const status: LocalVcsStatus = {
    isRepo: true,
    sourceControlProvider: detectSourceControlProvider(remoteUrl),
    hasPrimaryRemote: remoteUrl !== null,
    defaultRef: push.defaultRef,
    /*
     * Unknown counts as "yes", so the confirmation that guards a push to the default branch fails closed.
     * `refs/remotes/origin/HEAD` is what records the default branch locally, and `git clone` writes it while
     * `git init` plus `git remote add` does not - verified. In such a repository the default branch resolved to
     * nothing, this read false, and a one-click Commit & push reached the default branch with no confirmation
     * at all. Asking once too often is the harmless direction.
     */
    isDefaultRef: refName !== null && (push.defaultRef === null || refName === push.defaultRef),
    pushTargetRef: push.pushTargetRef,
    pushTargetIsDefaultRef: push.pushTargetIsDefaultRef,
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
  const probeFailure = await repositoryProbeFailure(projectPath)
  if (probeFailure) return probeFailure

  const fetchResult = await runWithGitNetworkLock(projectPath, () =>
    runGit(projectPath, ['fetch', '--quiet'], networkGitOptions(REMOTE_FETCH_TIMEOUT_MS)),
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
  if (!refName || !primaryRemote) return null
  const repository = parseRemoteRepositoryIdentity(primaryRemote.url)
  if (!repository) return null
  const provider = getSourceControlProvider(repository.provider, repository)
  if (!provider) return null
  const result = await provider.resolveChangeRequestForRef(projectPath, refName)
  return result.ok ? result.changeRequest : null
}
