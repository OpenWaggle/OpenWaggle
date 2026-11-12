import type {
  GitChangedFile,
  SourceControlProviderInfo,
  SourceControlRepositoryIdentity,
  VcsWorkingTree,
} from '@shared/types/git'
import { repositoryWebUrl } from './repository-web-url'
import { GIT_PARSE_INT_RADIX } from './status-constants'

/**
 * Detect the source control provider from a git remote URL.
 * Handles https and scp-like ssh forms for github.com / gitlab.com and
 * self-hosted hosts whose name contains "github" or "gitlab".
 */
export function detectSourceControlProvider(
  remoteUrl: string | null | undefined,
): SourceControlProviderInfo | null {
  const trimmed = remoteUrl?.trim()
  if (!trimmed) return null

  const webUrl = repositoryWebUrl(trimmed)
  if (!webUrl) return null
  const host = new URL(webUrl).hostname
  if (!host) return null

  const lowerHost = host.toLowerCase()
  if (lowerHost === 'github.com' || lowerHost.includes('github')) {
    return { id: 'github', host }
  }
  if (lowerHost === 'gitlab.com' || lowerHost.includes('gitlab')) {
    return { id: 'gitlab', host }
  }
  return null
}

export interface RemoteRepositoryIdentity extends SourceControlRepositoryIdentity {
  /** Normalized host authority, including a non-default URL port. */
  readonly authority: string
}

function sourceControlRepositoryHost(remoteUrl: string): string | null {
  const webUrl = repositoryWebUrl(remoteUrl)
  if (!webUrl) return null
  try {
    return new URL(webUrl).host.toLowerCase() || null
  } catch {
    return null
  }
}

/** Structured identity of the repository addressed by an HTTPS/SSH Git remote. */
export function parseRemoteRepositoryIdentity(remoteUrl: string): RemoteRepositoryIdentity | null {
  const trimmed = remoteUrl.trim().replace(/\/+$/u, '')
  const scpMatch = /^[^@/]+@[^:/]+:(?<path>.+)$/u.exec(trimmed)
  const urlMatch = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?[^/]+\/(?<path>.+)$/iu.exec(trimmed)
  const repositoryPath = (scpMatch?.groups?.path ?? urlMatch?.groups?.path)?.replace(/\.git$/u, '')
  const segments = repositoryPath?.split('/').filter(Boolean) ?? []
  const repository = segments.at(-1)
  const owner = segments.slice(0, -1).join('/')
  const provider = detectSourceControlProvider(remoteUrl)
  const authority = remoteRepositoryAuthority(trimmed)
  const host = sourceControlRepositoryHost(trimmed)
  if (!provider || !authority || !host || !owner || !repository) return null
  return { provider: provider.id, host, authority, owner, repository }
}

function remoteRepositoryAuthority(remoteUrl: string): string | null {
  const scpMatch = /^[^@/]+@(?<authority>[^:/]+):/u.exec(remoteUrl)
  if (scpMatch?.groups?.authority) return scpMatch.groups.authority.toLowerCase()
  try {
    return new URL(remoteUrl).host.toLowerCase() || null
  } catch {
    return null
  }
}

/**
 * Parse `git rev-list --left-right --count HEAD...@{upstream}` output.
 * Left = ahead of upstream, right = behind upstream.
 */
export function parseAheadBehind(stdout: string): { ahead: number; behind: number } {
  const [aheadStr, behindStr] = stdout.trim().split(/\s+/)
  return {
    ahead: parseCount(aheadStr),
    behind: parseCount(behindStr),
  }
}

export function parseCount(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '0', GIT_PARSE_INT_RADIX)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

/** Aggregate changed files into a working-tree summary (files + totals). */
export function toWorkingTree(changedFiles: readonly GitChangedFile[]): VcsWorkingTree {
  const files = changedFiles.map((file) => ({
    path: file.path,
    insertions: file.additions,
    deletions: file.deletions,
  }))
  return {
    files,
    insertions: files.reduce((sum, file) => sum + file.insertions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  }
}
