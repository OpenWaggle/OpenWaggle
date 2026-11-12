import { runGit } from '../../adapters/git/run-git'

export interface PrimaryRemote {
  readonly name: string
  readonly url: string
}

export type PrimaryRemoteResolution =
  | { readonly ok: true; readonly remote: PrimaryRemote | null }
  | { readonly ok: false; readonly message: string }

function remoteReadFailure(stderr: string) {
  const detail = stderr.trim()
  return detail ? `Could not read Git remotes: ${detail}` : 'Could not read Git remotes.'
}

/** Resolve the primary remote while preserving command failures for status callers that must retry. */
export async function resolvePrimaryRemoteResult(projectPath: string) {
  const originResult = await runGit(projectPath, ['remote', 'get-url', 'origin'])
  if (originResult.code === 0 && originResult.stdout.trim()) {
    const resolution: PrimaryRemoteResolution = {
      ok: true,
      remote: { name: 'origin', url: originResult.stdout.trim() },
    }
    return resolution
  }

  const listResult = await runGit(projectPath, ['remote'])
  if (listResult.code !== 0) {
    const resolution: PrimaryRemoteResolution = {
      ok: false,
      message: remoteReadFailure(listResult.stderr),
    }
    return resolution
  }
  const remoteNames = listResult.stdout
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean)
  // If origin still exists, its URL probe failed; choosing another remote would silently retarget
  // provider/default-branch decisions. Listing distinguishes absence without parsing localized stderr.
  if (remoteNames.includes('origin')) {
    const resolution: PrimaryRemoteResolution = {
      ok: false,
      message: remoteReadFailure(originResult.stderr),
    }
    return resolution
  }
  const firstRemote = remoteNames[0]
  if (!firstRemote) {
    const resolution: PrimaryRemoteResolution = { ok: true, remote: null }
    return resolution
  }
  const urlResult = await runGit(projectPath, ['remote', 'get-url', firstRemote])
  if (urlResult.code !== 0 || !urlResult.stdout.trim()) {
    const resolution: PrimaryRemoteResolution = {
      ok: false,
      message: remoteReadFailure(urlResult.stderr),
    }
    return resolution
  }
  const resolution: PrimaryRemoteResolution = {
    ok: true,
    remote: { name: firstRemote, url: urlResult.stdout.trim() },
  }
  return resolution
}

export async function resolvePrimaryRemote(projectPath: string) {
  const result = await resolvePrimaryRemoteResult(projectPath)
  return result.ok ? result.remote : null
}

export async function resolvePrimaryRemoteUrl(projectPath: string) {
  return (await resolvePrimaryRemote(projectPath))?.url ?? null
}
