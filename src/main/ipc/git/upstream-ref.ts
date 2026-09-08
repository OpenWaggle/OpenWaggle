import { runGit } from './shared'

export interface GitUpstreamRef {
  readonly remote: string
  readonly branch: string
}

export type GitUpstreamReadResult =
  | { readonly ok: true; readonly upstream: GitUpstreamRef | null }
  | { readonly ok: false; readonly message: string; readonly recoverable?: boolean }

export type GitPushRefReadResult =
  | {
      readonly ok: true
      readonly upstream: GitUpstreamRef | null
      /** True only when Git exposed no push remote and the caller supplied the first-push remote. */
      readonly usedFallbackRemote: boolean
    }
  | { readonly ok: false; readonly message: string; readonly recoverable?: boolean }

/**
 * Read one branch's configured upstream without using a failing Git exit status to mean “none”.
 *
 * `rev-parse @{upstream}` uses the same non-zero channel for a missing upstream and for failures
 * such as EAGAIN. `for-each-ref` represents the ordinary missing case as a successful empty value,
 * so callers can abort rather than accidentally changing the push destination after a failed read.
 */
export async function readUpstreamRef(
  projectPath: string,
  branchName: string | null,
): Promise<GitUpstreamReadResult> {
  if (branchName === null) return { ok: true, upstream: null }

  const result = await runGit(projectPath, [
    'for-each-ref',
    '--format=%(upstream:remotename)%00%(upstream:remoteref)',
    `refs/heads/${branchName}`,
  ])
  if (result.code !== 0) {
    const detail = result.stderr.trim()
    return {
      ok: false,
      message: detail
        ? `Could not read the configured Git upstream: ${detail}`
        : 'Could not read the configured Git upstream.',
    }
  }

  const [remote = '', trackedRef = ''] = result.stdout.replace(/\r?\n$/u, '').split('\0')
  if (remote.length === 0 && trackedRef.length === 0) return { ok: true, upstream: null }
  const branchPrefix = 'refs/heads/'
  if (
    !remote ||
    !trackedRef.startsWith(branchPrefix) ||
    trackedRef.length === branchPrefix.length
  ) {
    return {
      ok: false,
      message: 'Could not resolve the configured Git upstream.',
      recoverable: false,
    }
  }
  return {
    ok: true,
    upstream: { remote, branch: trackedRef.slice(branchPrefix.length) },
  }
}

async function readOptionalConfig(projectPath: string, key: string) {
  const result = await runGit(projectPath, ['config', '--get-all', key])
  if (result.code === 0) {
    return {
      ok: true,
      values: result.stdout
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean),
    } as const
  }
  if (!result.executionFailed && !result.stderr.trim()) return { ok: true, values: [] } as const
  const detail = result.stderr.trim()
  return {
    ok: false,
    message: detail
      ? `Could not read Git push configuration: ${detail}`
      : 'Could not read Git push configuration.',
  } as const
}

function isTrueGitBoolean(value: string | undefined) {
  return value !== undefined && ['true', 'yes', 'on', '1'].includes(value.toLowerCase())
}

function resolveConfiguredPushRef(
  branchName: string,
  remote: string,
  refspecs: readonly string[],
): GitUpstreamReadResult {
  if (refspecs.length !== 1) {
    return {
      ok: false,
      message: 'OpenWaggle cannot safely run a push configured to update multiple refs.',
      recoverable: false,
    }
  }
  const refspec = (refspecs[0] ?? '').replace(/^\+/u, '')
  const separator = refspec.indexOf(':')
  const source = separator === -1 ? refspec : refspec.slice(0, separator)
  const destination = separator === -1 ? source : refspec.slice(separator + 1)
  const sourceMatches =
    source === 'HEAD' || source === branchName || source === `refs/heads/${branchName}`
  const branchPrefix = 'refs/heads/'
  if (
    !sourceMatches ||
    !destination.startsWith(branchPrefix) ||
    destination.length === branchPrefix.length
  ) {
    return {
      ok: false,
      message: 'OpenWaggle cannot safely reduce the configured push refspec to the current branch.',
      recoverable: false,
    }
  }
  return {
    ok: true,
    upstream: { remote, branch: destination.slice(branchPrefix.length) },
  }
}

async function resolvePushRefFromConfig(
  projectPath: string,
  branchName: string,
  remote: string,
): Promise<GitUpstreamReadResult> {
  const configuredPushRef = await resolveRemotePushRefspec(projectPath, branchName, remote)
  if (configuredPushRef !== null) return configuredPushRef

  return resolveDefaultPushRef(projectPath, branchName, remote)
}

async function resolveRemotePushRefspec(
  projectPath: string,
  branchName: string,
  remote: string,
): Promise<GitUpstreamReadResult | null> {
  const mirror = await readOptionalConfig(projectPath, `remote.${remote}.mirror`)
  if (!mirror.ok) return mirror
  if (isTrueGitBoolean(mirror.values.at(-1))) {
    return {
      ok: false,
      message: 'OpenWaggle cannot safely run a mirror push.',
      recoverable: false,
    }
  }
  const configured = await readOptionalConfig(projectPath, `remote.${remote}.push`)
  if (!configured.ok) return configured
  if (configured.values.length > 0) {
    return resolveConfiguredPushRef(branchName, remote, configured.values)
  }

  return null
}

async function resolveDefaultPushRef(
  projectPath: string,
  branchName: string,
  remote: string,
): Promise<GitUpstreamReadResult> {
  const pushDefaultResult = await readOptionalConfig(projectPath, 'push.default')
  if (!pushDefaultResult.ok) return pushDefaultResult
  const pushDefault = pushDefaultResult.values.at(-1) ?? 'simple'
  if (pushDefault === 'nothing' || pushDefault === 'matching') {
    return {
      ok: false,
      message: `OpenWaggle cannot safely run push.default=${pushDefault} as a single-branch action.`,
      recoverable: false,
    }
  }
  if (pushDefault === 'current') {
    return { ok: true, upstream: { remote, branch: branchName } }
  }

  const upstreamResult = await readUpstreamRef(projectPath, branchName)
  if (!upstreamResult.ok) return upstreamResult
  return resolveTrackedPushRef(pushDefault, branchName, remote, upstreamResult.upstream)
}

function resolveTrackedPushRef(
  pushDefault: string,
  branchName: string,
  remote: string,
  upstream: GitUpstreamRef | null,
): GitUpstreamReadResult {
  if (pushDefault === 'upstream' || pushDefault === 'tracking') {
    if (!upstream || upstream.remote !== remote) {
      return {
        ok: false,
        message: 'The configured upstream push destination does not match the push remote.',
        recoverable: false,
      }
    }
    return { ok: true, upstream }
  }
  if (pushDefault !== 'simple') {
    return {
      ok: false,
      message: `Unsupported Git push.default value: ${pushDefault}.`,
      recoverable: false,
    }
  }
  if (!upstream || upstream.remote !== remote) {
    return { ok: true, upstream: { remote, branch: branchName } }
  }
  return upstream.branch === branchName
    ? { ok: true, upstream: { remote, branch: branchName } }
    : {
        ok: false,
        message:
          'push.default=simple refuses because the current and upstream branch names differ.',
        recoverable: false,
      }
}

async function resolvePushRemoteFromConfig(
  projectPath: string,
  branchName: string,
  fallbackRemote: string | null,
) {
  const keys = [
    `branch.${branchName}.pushRemote`,
    'remote.pushDefault',
    `branch.${branchName}.remote`,
  ] as const
  for (const key of keys) {
    const configured = await readOptionalConfig(projectPath, key)
    if (!configured.ok) return configured
    const remote = configured.values.at(-1)
    if (!remote) continue
    if (remote === '.') {
      return {
        ok: false,
        message: 'OpenWaggle cannot safely run a push configured for the local repository.',
        recoverable: false,
      } as const
    }
    return { ok: true, remote, usedFallbackRemote: false } as const
  }
  return { ok: true, remote: fallbackRemote, usedFallbackRemote: fallbackRemote !== null } as const
}

/** Resolve the destination Git derives from pushRemote, pushDefault, and push.default. */
export async function readPushRef(
  projectPath: string,
  branchName: string | null,
  fallbackRemote: string | null = null,
): Promise<GitPushRefReadResult> {
  if (branchName === null) return { ok: true, upstream: null, usedFallbackRemote: false }
  const remoteResult = await runGit(projectPath, [
    'for-each-ref',
    '--format=%(push:remotename)',
    `refs/heads/${branchName}`,
  ])
  if (remoteResult.code !== 0) {
    const detail = remoteResult.stderr.trim()
    return {
      ok: false,
      message: detail
        ? `Could not read the Git push destination: ${detail}`
        : 'Could not read the Git push destination.',
    }
  }
  const configuredRemote = remoteResult.stdout.trim()
  if (configuredRemote === '.') {
    return {
      ok: false,
      message: 'OpenWaggle cannot safely run a push configured for the local repository.',
      recoverable: false,
    }
  }
  const fallbackResult = configuredRemote
    ? ({ ok: true, remote: configuredRemote, usedFallbackRemote: false } as const)
    : await resolvePushRemoteFromConfig(projectPath, branchName, fallbackRemote)
  if (!fallbackResult.ok) return fallbackResult
  const remote = fallbackResult.remote
  if (!remote) return { ok: true, upstream: null, usedFallbackRemote: false }

  const resolved = await resolvePushRefFromConfig(projectPath, branchName, remote)
  return resolved.ok
    ? {
        ...resolved,
        usedFallbackRemote: fallbackResult.usedFallbackRemote,
      }
    : resolved
}
