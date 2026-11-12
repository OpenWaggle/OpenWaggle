import { namedGroups } from '@shared/utils/regex-named-groups'
import type {
  GitChangedFile,
  SourceControlProviderInfo,
  VcsWorkingTree,
  SourceControlRepositoryIdentity,
} from '@shared/types/git'
import { repositoryWebUrl } from './repository-web-url'
import { GIT_PARSE_INT_RADIX } from './status-constants'

export interface RemoteRepositoryIdentity extends SourceControlRepositoryIdentity {
  /** Normalized host authority, including a non-default URL port. */
  readonly authority: string
}

/**
 * Detect the source control provider from a git remote URL.
 * Handles https and scp-like ssh forms for github.com / gitlab.com and
 * self-hosted hosts whose name contains "github" or "gitlab".
 */
export function detectSourceControlProvider(remoteUrl: string | null | undefined) {
  const trimmed = remoteUrl?.trim()
  if (!trimmed) return null

  const webUrl = repositoryWebUrl(trimmed)
  if (!webUrl) return null
  const host = new URL(webUrl).hostname
  if (!host) return null

  const lowerHost = host.toLowerCase()
  if (lowerHost === 'github.com' || lowerHost.includes('github')) {
    return { id: 'github', host } satisfies SourceControlProviderInfo
  }
  if (lowerHost === 'gitlab.com' || lowerHost.includes('gitlab')) {
    return { id: 'gitlab', host } satisfies SourceControlProviderInfo
  }
  return null
}

function sourceControlRepositoryHost(remoteUrl: string) {
  const webUrl = repositoryWebUrl(remoteUrl)
  if (!webUrl) return null
  try {
    return new URL(webUrl).host.toLowerCase() || null
  } catch {
    return null
  }
}

/** Structured identity of the repository addressed by an HTTPS/SSH Git remote. */
export function parseRemoteRepositoryIdentity(remoteUrl: string) {
  const trimmed = remoteUrl.trim().replace(/\/+$/u, '')
  const scpMatch = /^[^@/]+@[^:/]+:(?<path>.+)$/u.exec(trimmed)
  const urlMatch = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?[^/]+\/(?<path>.+)$/iu.exec(trimmed)
  const repositoryPath = (
    namedGroups(scpMatch, ['path'])?.path ?? namedGroups(urlMatch, ['path'])?.path
  )?.replace(/\.git$/u, '')
  const segments = repositoryPath?.split('/').filter(Boolean) ?? []
  const repository = segments.at(-1)
  const owner = segments.slice(0, -1).join('/')
  const provider = detectSourceControlProvider(remoteUrl)
  const authority = remoteRepositoryAuthority(trimmed)
  const host = sourceControlRepositoryHost(trimmed)
  if (!provider || !authority || !host || !owner || !repository) return null
  const identity: RemoteRepositoryIdentity | null = {
    provider: provider.id,
    host,
    authority,
    owner,
    repository,
  }
  return identity
}

function remoteRepositoryAuthority(remoteUrl: string) {
  const scpMatch = /^[^@/]+@(?<authority>[^:/]+):/u.exec(remoteUrl)
  const authority = namedGroups(scpMatch, ['authority'])?.authority
  if (authority) return authority.toLowerCase()
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
export function parseAheadBehind(stdout: string) {
  const [aheadStr, behindStr] = stdout.trim().split(/\s+/)
  return {
    ahead: parseCount(aheadStr),
    behind: parseCount(behindStr),
  }
}

export function parseCount(value: string | undefined) {
  const parsed = Number.parseInt(value ?? '0', GIT_PARSE_INT_RADIX)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

/** Aggregate changed files into a working-tree summary (files + totals). */
export function toWorkingTree(changedFiles: readonly GitChangedFile[]) {
  const files = changedFiles.map((file) => ({
    path: file.path,
    insertions: file.additions,
    deletions: file.deletions,
  }))
  const tree: VcsWorkingTree = {
    files,
    insertions: files.reduce((sum, file) => sum + file.insertions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  }
  return tree
}
