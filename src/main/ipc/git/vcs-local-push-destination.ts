import { resolveLocalDefaultRef } from './default-ref'
import type { PrimaryRemote } from './primary-remote'
import { runGit } from './shared'
import { readPushRef } from './upstream-ref'

export type SafeLocalPushDestination =
  | {
      readonly ok: true
      readonly defaultRef: string | null
      readonly fetchUrl: string
      readonly pushUrls: readonly string[]
    }
  | { readonly ok: false; readonly message: string }

/** Resolve a locally recorded default only when it describes the repository a push will reach. */
export async function resolveSafeLocalPushDestination(
  projectPath: string,
  pushRemoteName: string,
  primaryRemote: PrimaryRemote | null,
  primaryDefaultRef: string | null,
): Promise<SafeLocalPushDestination> {
  const [fetchUrlResult, pushUrlsResult] = await Promise.all([
    primaryRemote?.name === pushRemoteName
      ? Promise.resolve({ code: 0, stdout: `${primaryRemote.url}\n`, stderr: '' })
      : runGit(projectPath, ['remote', 'get-url', pushRemoteName]),
    runGit(projectPath, ['remote', 'get-url', '--push', '--all', pushRemoteName]),
  ])
  const failed = [fetchUrlResult, pushUrlsResult].find((result) => result.code !== 0)
  if (failed) {
    const detail = failed.stderr.trim()
    return {
      ok: false,
      message: detail
        ? `Could not read the Git push destination: ${detail}`
        : 'Could not read the Git push destination.',
    }
  }

  const fetchUrl = fetchUrlResult.stdout.trim()
  const pushUrls = [
    ...new Set(
      pushUrlsResult.stdout
        .split('\n')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]
  const defaultRef =
    fetchUrl && pushUrls.length === 1 && pushUrls[0] === fetchUrl
      ? primaryRemote?.name === pushRemoteName
        ? primaryDefaultRef
        : await resolveLocalDefaultRef(projectPath, pushRemoteName)
      : null

  return { ok: true, defaultRef, fetchUrl, pushUrls }
}

export async function resolveLocalPushStatus(
  projectPath: string,
  refName: string | null,
  primaryRemote: PrimaryRemote | null,
  shouldResolvePushDestination: boolean,
) {
  const primaryRemoteName = primaryRemote?.name ?? 'origin'
  const defaultRef = await resolveLocalDefaultRef(projectPath, primaryRemoteName)
  if (!shouldResolvePushDestination) {
    return {
      ok: true as const,
      defaultRef,
      pushTargetRef: refName,
      pushTargetIsDefaultRef: false,
    }
  }

  const pushResult = await readPushRef(projectPath, refName, primaryRemoteName)
  if (!pushResult.ok) return pushResult
  const pushRemoteName = pushResult.upstream?.remote ?? primaryRemoteName
  const destination = await resolveSafeLocalPushDestination(
    projectPath,
    pushRemoteName,
    primaryRemote,
    defaultRef,
  )
  const pushDefaultRef = destination.ok ? destination.defaultRef : null
  const pushTargetRef = pushResult.upstream?.branch ?? refName
  return {
    ok: true as const,
    defaultRef,
    pushTargetRef,
    pushTargetIsDefaultRef:
      pushTargetRef !== null && (pushDefaultRef === null || pushTargetRef === pushDefaultRef),
  }
}
