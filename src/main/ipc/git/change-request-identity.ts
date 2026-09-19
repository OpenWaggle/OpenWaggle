import type { SourceControlProviderId } from '@shared/types/git'
import { repositoryWebUrl } from './repository-web-url'

export interface ChangeRequestIdentity {
  readonly reference: string
  readonly url: string
}

function trimTrailingSlash(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/u, '') : pathname
}

/**
 * Bind an untrusted request URL to the repository selected from the Session working tree.
 *
 * CLI commands receive only the numeric provider-local reference produced here, never the
 * renderer-provided URL. This prevents a stale panel or crafted IPC call from switching to a
 * different repository on the same provider host.
 */
export function resolveChangeRequestIdentity(
  remoteUrl: string,
  provider: SourceControlProviderId,
  requestedUrl: string,
): ChangeRequestIdentity | null {
  const repositoryUrl = repositoryWebUrl(remoteUrl)
  if (!repositoryUrl) return null
  try {
    const repository = new URL(repositoryUrl)
    const requested = new URL(requestedUrl)
    if (!['http:', 'https:'].includes(requested.protocol)) return null
    if (repository.origin !== requested.origin) return null
    const repositoryPath = trimTrailingSlash(repository.pathname)
    const requestPath = trimTrailingSlash(requested.pathname)
    const prefix =
      provider === 'github' ? `${repositoryPath}/pull/` : `${repositoryPath}/-/merge_requests/`
    if (!requestPath.startsWith(prefix)) return null
    const reference = requestPath.slice(prefix.length)
    if (!/^\d+$/u.test(reference)) return null
    return { reference, url: `${repository.origin}${prefix}${reference}` }
  } catch {
    return null
  }
}
