import type { SourceControlRepositoryIdentity } from '@shared/types/git'

export interface RepositoryChangeRequestIdentity {
  readonly reference: string
  readonly url: string
}

function repositoryPath(repository: SourceControlRepositoryIdentity) {
  return `/${repository.owner}/${repository.repository}`
}

export function sameSourceControlRepository(
  left: SourceControlRepositoryIdentity,
  right: SourceControlRepositoryIdentity,
) {
  return (
    left.provider === right.provider &&
    left.host.toLowerCase() === right.host.toLowerCase() &&
    left.owner.toLowerCase() === right.owner.toLowerCase() &&
    left.repository.toLowerCase() === right.repository.toLowerCase()
  )
}

/** Explicit selector accepted by GitHub CLI's repository-scoped commands. */
export function githubRepositorySelector(repository: SourceControlRepositoryIdentity) {
  return `${repository.host}/${repository.owner}/${repository.repository}`
}

/** Explicit selector accepted by GitLab CLI, including self-hosted instances. */
export function gitlabRepositorySelector(repository: SourceControlRepositoryIdentity) {
  return `https://${repository.host}${repositoryPath(repository)}`
}

export function matchesRepositoryUrl(repository: SourceControlRepositoryIdentity, rawUrl: string) {
  try {
    const expected = new URL(`https://${repository.host}${repositoryPath(repository)}`)
    const actual = new URL(rawUrl)
    return (
      ['http:', 'https:'].includes(actual.protocol) &&
      actual.origin.toLowerCase() === expected.origin.toLowerCase() &&
      trimTrailingSlash(actual.pathname).toLowerCase() ===
        trimTrailingSlash(expected.pathname).toLowerCase()
    )
  } catch {
    return false
  }
}

function trimTrailingSlash(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/u, '') : pathname
}

/**
 * Verify and canonicalize a provider-returned PR/MR URL against the repository approved from Git.
 */
export function resolveRepositoryChangeRequestIdentity(
  repository: SourceControlRepositoryIdentity,
  rawUrl: string,
): RepositoryChangeRequestIdentity | null {
  try {
    const expected = new URL(`https://${repository.host}${repositoryPath(repository)}`)
    const requested = new URL(rawUrl)
    if (!['http:', 'https:'].includes(requested.protocol)) return null
    if (requested.origin.toLowerCase() !== expected.origin.toLowerCase()) return null
    const expectedPath = trimTrailingSlash(expected.pathname)
    const requestedPath = trimTrailingSlash(requested.pathname)
    const prefix =
      repository.provider === 'github'
        ? `${expectedPath}/pull/`
        : `${expectedPath}/-/merge_requests/`
    if (!requestedPath.startsWith(prefix)) return null
    const reference = requestedPath.slice(prefix.length)
    if (!/^\d+$/u.test(reference)) return null
    return { reference, url: `${expected.origin}${prefix}${reference}` }
  } catch {
    return null
  }
}

/**
 * Collapse a same-repository URL to its provider-local number before passing it to a CLI.
 * Branch names and already-local numeric references pass through unchanged.
 */
export function repositoryBoundChangeRequestReference(
  repository: SourceControlRepositoryIdentity,
  reference: string,
): string | null {
  const trimmed = reference.trim()
  if (!trimmed) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//iu.test(trimmed)) return trimmed
  return resolveRepositoryChangeRequestIdentity(repository, trimmed)?.reference ?? null
}
