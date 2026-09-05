import { runGit } from './shared'

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
export async function resolvePrimaryRemoteResult(
  projectPath: string,
): Promise<PrimaryRemoteResolution> {
  const originResult = await runGit(projectPath, ['remote', 'get-url', 'origin'])
  if (originResult.code === 0 && originResult.stdout.trim()) {
    return { ok: true, remote: { name: 'origin', url: originResult.stdout.trim() } }
  }

  const listResult = await runGit(projectPath, ['remote'])
  if (listResult.code !== 0) {
    return { ok: false, message: remoteReadFailure(listResult.stderr) }
  }
  const firstRemote = listResult.stdout.trim().split('\n')[0]?.trim()
  if (!firstRemote) return { ok: true, remote: null }
  const urlResult = await runGit(projectPath, ['remote', 'get-url', firstRemote])
  if (urlResult.code !== 0 || !urlResult.stdout.trim()) {
    return { ok: false, message: remoteReadFailure(urlResult.stderr) }
  }
  return { ok: true, remote: { name: firstRemote, url: urlResult.stdout.trim() } }
}

export async function resolvePrimaryRemote(projectPath: string): Promise<PrimaryRemote | null> {
  const result = await resolvePrimaryRemoteResult(projectPath)
  return result.ok ? result.remote : null
}

export async function resolvePrimaryRemoteUrl(projectPath: string): Promise<string | null> {
  return (await resolvePrimaryRemote(projectPath))?.url ?? null
}
