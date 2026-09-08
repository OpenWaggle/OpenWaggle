import { randomUUID } from 'node:crypto'
import { networkGitOptions } from '../../adapters/git/run-git'
import { runWithGitNetworkLock } from '../../services/git/mutation-lock'
import { resolvePrimaryRemoteResult } from './primary-remote'
import { isGitRepository, runGit } from './shared'
import {
  type GitPushRefReadResult,
  type GitUpstreamRef,
  readPushRef,
  readUpstreamRef,
} from './upstream-ref'

/**
 * Long enough to transfer objects over a slow link, short enough that the UI is never stuck for good.
 *
 * A push, pull or fetch reaches the network from an interactive path, so it must be bounded and must never
 * prompt: without this it blocks for git's own connect timeout, or forever on a credential prompt.
 */
const PUSH_TIMEOUT_MS = 120_000

export interface GitPushResult {
  readonly ok: boolean
  readonly code: 'ok' | 'not-git-repo' | 'no-upstream' | 'push-failed'
  readonly message: string
  readonly destination?: GitPushDestination
}

export interface GitPushDestination {
  readonly remote: string
  readonly branch: string
  /** The one configured push URL, or null when it cannot be resolved unambiguously. */
  readonly remoteUrl: string | null
  readonly multiplePushUrls: boolean
}

/** Destination approved by the default-branch gate and revalidated before a stacked action starts. */
export interface GitPinnedPushTarget {
  readonly sourceBranch: string
  readonly remote: string
  readonly branch: string
  readonly pushUrls: readonly string[]
}

export interface GitPullResult {
  readonly ok: boolean
  readonly code: 'ok' | 'not-git-repo' | 'pull-failed'
  readonly message: string
}

async function currentBranch(
  projectPath: string,
): Promise<{ readonly ok: true; readonly branch: string | null } | { readonly ok: false }> {
  const result = await runGit(projectPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  if (result.code !== 0) {
    return result.executionFailed === true || result.stderr.trim()
      ? { ok: false }
      : { ok: true, branch: null }
  }
  return { ok: true, branch: result.stdout.trim() || null }
}

async function resolvePushDestination(
  projectPath: string,
  remote: string,
  branch: string,
): Promise<
  | { readonly ok: true; readonly destination: GitPushDestination; readonly pushUrls: string[] }
  | { readonly ok: false; readonly message: string }
> {
  const result = await runGit(projectPath, ['remote', 'get-url', '--push', '--all', remote])
  if (result.code !== 0) {
    const detail = result.stderr.trim()
    return {
      ok: false,
      message: detail
        ? `Could not read the Git push destination: ${detail}`
        : 'Could not read the Git push destination.',
    }
  }
  const remoteUrls = [
    ...new Set(
      result.stdout
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]
  return {
    ok: true,
    pushUrls: remoteUrls,
    destination: {
      remote,
      branch,
      remoteUrl: remoteUrls.length === 1 ? (remoteUrls[0] ?? null) : null,
      multiplePushUrls: remoteUrls.length > 1,
    },
  }
}

function successfulPush(destination: GitPushDestination, message: string): GitPushResult {
  return {
    ok: true,
    code: 'ok',
    message,
    destination,
  }
}

async function readPushRefWithFallback(
  projectPath: string,
  branch: string,
  firstPushRemote: string | undefined,
): Promise<GitPushRefReadResult> {
  const configuredPushRef = await readPushRef(projectPath, branch)
  if (!configuredPushRef.ok || configuredPushRef.upstream) return configuredPushRef

  const primaryRemoteResult = firstPushRemote ? null : await resolvePrimaryRemoteResult(projectPath)
  if (primaryRemoteResult && !primaryRemoteResult.ok) return primaryRemoteResult

  const fallbackRemote = firstPushRemote ?? primaryRemoteResult?.remote?.name ?? 'origin'
  return readPushRef(projectPath, branch, fallbackRemote)
}

function pushUrlsMatch(actual: readonly string[], expected: readonly string[]) {
  return actual.length === expected.length && actual.every((url, index) => url === expected[index])
}

interface GitCommandConfigEntry {
  readonly key: string
  readonly value: string
}

function commandScopeGitEnvironment(entries: readonly GitCommandConfigEntry[]) {
  const environment: Record<string, string> = {
    // Do not let an inherited command-scope config append a competing rewrite after these pins.
    GIT_CONFIG_PARAMETERS: '',
    GIT_CONFIG_COUNT: String(entries.length),
  }
  for (const [index, entry] of entries.entries()) {
    environment[`GIT_CONFIG_KEY_${index}`] = entry.key
    environment[`GIT_CONFIG_VALUE_${index}`] = entry.value
  }
  return environment
}

function pinnedPushUrlConfig(target: GitPinnedPushTarget | undefined) {
  if (!target) return { ok: true as const, args: [], environment: undefined }
  // `git -c` separates a key from its value at the first equals sign. A configured remote may
  // legally contain `=`, but interpolating that name would pin a different config key and reopen
  // the destination-change race this command-scope override closes.
  if (target.remote.includes('=')) {
    return {
      ok: false as const,
      message: 'The approved Git remote name cannot be pinned safely.',
    }
  }
  const key = `remote.${target.remote}.pushurl`
  const aliases = target.pushUrls.map((url) => ({
    alias: `openwaggle-push-${randomUUID()}:`,
    url,
  }))
  // Git applies url.*.insteadOf even to an explicit remote pushurl. Give each approved URL an
  // unpredictable invocation-only alias and map that alias to the URL at command scope. Rewrites
  // are applied once, so repository/global rules matching the approved URL cannot redirect the
  // result. The empty pushurl remains the documented reset for lower-priority multi-valued URLs.
  const entries: GitCommandConfigEntry[] = aliases.map(({ alias, url }) => ({
    key: `url.${url}.insteadOf`,
    value: alias,
  }))
  return {
    ok: true as const,
    args: ['-c', `${key}=`, ...aliases.flatMap(({ alias }) => ['-c', `${key}=${alias}`])],
    environment: commandScopeGitEnvironment(entries),
  }
}

async function pushResolvedRef(
  projectPath: string,
  pushRef: GitUpstreamRef,
  shouldSetUpstream: boolean,
  pinnedTarget: GitPinnedPushTarget | undefined,
): Promise<GitPushResult> {
  const destinationResult = await resolvePushDestination(
    projectPath,
    pushRef.remote,
    pushRef.branch,
  )
  if (!destinationResult.ok) {
    return { ok: false, code: 'push-failed', message: destinationResult.message }
  }
  if (pinnedTarget && !pushUrlsMatch(destinationResult.pushUrls, pinnedTarget.pushUrls)) {
    return {
      ok: false,
      code: 'push-failed',
      message: 'The Git push URL changed after the destination was confirmed.',
    }
  }
  if (pinnedTarget && pinnedTarget.pushUrls.length === 0) {
    return {
      ok: false,
      code: 'push-failed',
      message: 'Could not resolve a Git push URL for the approved destination.',
    }
  }

  const pinnedConfig = pinnedPushUrlConfig(pinnedTarget)
  if (!pinnedConfig.ok) {
    return { ok: false, code: 'push-failed', message: pinnedConfig.message }
  }
  const pushArgs = shouldSetUpstream
    ? ['push', '-u', pushRef.remote, `HEAD:refs/heads/${pushRef.branch}`]
    : ['push', pushRef.remote, `HEAD:refs/heads/${pushRef.branch}`]
  const networkOptions = networkGitOptions(PUSH_TIMEOUT_MS)
  const result = await runGit(
    projectPath,
    [...pinnedConfig.args, ...pushArgs],
    pinnedConfig.environment
      ? {
          ...networkOptions,
          env: { ...networkOptions.env, ...pinnedConfig.environment },
        }
      : networkOptions,
  )
  return result.code === 0
    ? successfulPush(
        destinationResult.destination,
        shouldSetUpstream
          ? `Pushed and set upstream to ${pushRef.remote}/${pushRef.branch}.`
          : `Pushed to ${pushRef.remote}/${pushRef.branch}.`,
      )
    : { ok: false, code: 'push-failed', message: result.stderr.trim() || 'Failed to push.' }
}

/** Push the current branch, setting upstream to the selected remote on first push. */
export async function pushCurrentBranch(
  projectPath: string,
  firstPushRemote?: string,
  pinnedTarget?: GitPinnedPushTarget,
): Promise<GitPushResult> {
  if (!(await isGitRepository(projectPath))) {
    return { ok: false, code: 'not-git-repo', message: 'Selected folder is not a Git repository.' }
  }

  const branchResult = await currentBranch(projectPath)
  if (!branchResult.ok) {
    return { ok: false, code: 'push-failed', message: 'Could not read the current Git branch.' }
  }
  const branch = branchResult.branch
  if (!branch) {
    return { ok: false, code: 'no-upstream', message: 'Cannot push a detached HEAD.' }
  }

  if (pinnedTarget && pinnedTarget.sourceBranch !== branch) {
    return {
      ok: false,
      code: 'push-failed',
      message: 'The current branch changed after the Git destination was confirmed.',
    }
  }

  const pushRefResult: GitPushRefReadResult = pinnedTarget
    ? {
        ok: true,
        upstream: { remote: pinnedTarget.remote, branch: pinnedTarget.branch },
        usedFallbackRemote: false,
      }
    : await readPushRefWithFallback(projectPath, branch, firstPushRemote)

  if (!pushRefResult.ok) {
    return { ok: false, code: 'push-failed', message: pushRefResult.message }
  }
  if (!pushRefResult.upstream) {
    return { ok: false, code: 'no-upstream', message: 'Could not resolve a Git push destination.' }
  }
  const pushRef = pushRefResult.upstream
  const fetchUpstreamResult = await readUpstreamRef(projectPath, branch)
  if (!fetchUpstreamResult.ok) {
    return { ok: false, code: 'push-failed', message: fetchUpstreamResult.message }
  }
  const shouldSetUpstream = fetchUpstreamResult.upstream === null
  return runWithGitNetworkLock(projectPath, () =>
    pushResolvedRef(projectPath, pushRef, shouldSetUpstream, pinnedTarget),
  )
}

/** Pull the current branch. */
export async function pullCurrentBranch(projectPath: string): Promise<GitPullResult> {
  if (!(await isGitRepository(projectPath))) {
    return { ok: false, code: 'not-git-repo', message: 'Selected folder is not a Git repository.' }
  }
  const result = await runWithGitNetworkLock(projectPath, () =>
    runGit(projectPath, ['pull', '--ff-only'], networkGitOptions(PUSH_TIMEOUT_MS)),
  )
  return result.code === 0
    ? { ok: true, code: 'ok', message: 'Pulled latest changes.' }
    : { ok: false, code: 'pull-failed', message: result.stderr.trim() || 'Failed to pull.' }
}
