import type { GitChangedFile, SourceControlProviderInfo, VcsWorkingTree } from '@shared/types/git'
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

  const host = extractRemoteHost(trimmed)
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

function extractRemoteHost(remoteUrl: string): string | null {
  // scp-like: git@host:owner/repo.git
  const scpMatch = /^[^@/]+@([^:/]+):/.exec(remoteUrl)
  if (scpMatch?.[1]) return scpMatch[1]

  // url form: scheme://[user@]host[:port]/...
  const urlMatch = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^:/]+)/i.exec(remoteUrl)
  if (urlMatch?.[1]) return urlMatch[1]

  return null
}

export interface RemoteRepositoryIdentity {
  readonly provider: SourceControlProviderInfo['id']
  /** Normalized host authority, including a non-default URL port. */
  readonly authority: string
  readonly owner: string
  readonly repository: string
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
  if (!provider || !authority || !owner || !repository) return null
  return { provider: provider.id, authority, owner, repository }
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
