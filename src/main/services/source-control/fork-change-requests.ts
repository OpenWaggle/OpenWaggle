import type {
  ChangeRequestResult,
  SourceControlRepositoryIdentity,
} from '@shared/types/change-request'
import {
  sourceControlRepositoryKey,
  sourceControlRepositoryReference,
} from '@shared/types/source-control'
import { runGit } from '../../adapters/git/run-git'
import type { ForkParentLookup, SourceControlProvider } from '../../ports/source-control-provider'
import type { SourceControlSettingsAccess } from './source-control-settings-access'
import {
  providerForRepository,
  resolveLiveRemoteUrlRepository,
  type WorkingTreeSourceControl,
} from './working-tree-source-control'

/** Most repositories whose fork parent is remembered in memory. */
const FORK_PARENT_CACHE_LIMIT = 500

function parseRepositoryKey(
  key: string,
  provider: SourceControlRepositoryIdentity['provider'],
): SourceControlRepositoryIdentity | null {
  const [host, ...rest] = key.split('/')
  const repository = rest.at(-1)
  const owner = rest.slice(0, -1).join('/')
  return host && owner && repository ? { provider, host, owner, repository } : null
}

/** Answered fork-parent lookups; failed lookups are not kept, so they are asked again. */
const forkParentLookups = new Map<string, SourceControlRepositoryIdentity | null>()

export function clearForkParentLookupsForTests() {
  forkParentLookups.clear()
}

async function forkParent(
  key: string,
  lookup: () => Promise<ForkParentLookup>,
): Promise<SourceControlRepositoryIdentity | null> {
  if (forkParentLookups.has(key)) return forkParentLookups.get(key) ?? null
  const answer = await lookup()
  if (!answer.ok) return null
  if (forkParentLookups.size >= FORK_PARENT_CACHE_LIMIT) {
    const oldest = forkParentLookups.keys().next().value
    if (oldest !== undefined) forkParentLookups.delete(oldest)
  }
  forkParentLookups.set(key, answer.parent)
  return answer.parent
}

/** Resolves a working tree's `upstream` remote, if any, to its repository. */
export type UpstreamRepositoryResolver = (
  workingPath: string,
) => Promise<SourceControlRepositoryIdentity | null>

/** The `upstream` remote through the shared resolver, so SSH aliases resolve like `origin`. */
export function liveUpstreamRepository(
  access: SourceControlSettingsAccess,
): UpstreamRepositoryResolver {
  return async (workingPath) => {
    const result = await runGit(workingPath, ['remote', 'get-url', 'upstream'])
    const url = result.code === 0 ? result.stdout.trim() : ''
    if (!url) return null
    return (await resolveLiveRemoteUrlRepository(workingPath, url, access))?.repository ?? null
  }
}

async function forkTargets(
  sourceControl: WorkingTreeSourceControl,
  workingPath: string,
  access: SourceControlSettingsAccess,
  resolveUpstream: UpstreamRepositoryResolver,
) {
  const origin = sourceControl.repository
  const key = sourceControlRepositoryKey(origin)
  const settings = await access.read()
  const remembered = settings.sourceControlChangeRequestRepositories[key]
  const targets: SourceControlRepositoryIdentity[] = []
  const rememberedTarget = remembered ? parseRepositoryKey(remembered, origin.provider) : null
  if (rememberedTarget) targets.push(rememberedTarget)
  const parent = await forkParent(key, () => sourceControl.provider.forkParent(workingPath))
  if (parent) targets.push(parent)
  const upstream = await resolveUpstream(workingPath)
  if (upstream && upstream.host === origin.host && upstream.provider === origin.provider) {
    targets.push(upstream)
  }
  const unique = new Map(
    targets
      .filter((target) => sourceControlRepositoryKey(target) !== key)
      .map((target) => [sourceControlRepositoryKey(target), target]),
  )
  return [...unique.values()]
}

export interface CurrentChangeRequest {
  readonly result: ChangeRequestResult
  /** The provider bound to the repository that holds the change request. */
  readonly provider: SourceControlProvider
  readonly repository: SourceControlRepositoryIdentity
}

/**
 * The change request for the current branch: in the remote's own repository, otherwise in the
 * repository it was forked from or an `upstream` remote, matched by the fork's head.
 */
export async function findCurrentChangeRequest(
  sourceControl: WorkingTreeSourceControl,
  workingPath: string,
  branch: string,
  access: SourceControlSettingsAccess,
  resolveUpstream: UpstreamRepositoryResolver = liveUpstreamRepository(access),
  createProvider: typeof providerForRepository = providerForRepository,
): Promise<CurrentChangeRequest> {
  const own = await sourceControl.provider.resolveChangeRequestForRef(workingPath, branch)
  const fallback = {
    result: own,
    provider: sourceControl.provider,
    repository: sourceControl.repository,
  }
  if (own.ok || own.code !== 'no-change-request') return fallback
  const origin = sourceControl.repository
  const settings = await access.read()
  for (const target of await forkTargets(sourceControl, workingPath, access, resolveUpstream)) {
    const targetKey = sourceControlRepositoryKey(target)
    const provider = createProvider(
      target,
      access,
      settings.sourceControlRepositoryAccounts[targetKey] ?? null,
    )
    if (!provider) continue
    const result = await provider.findChangeRequestForForkHead(workingPath, {
      ref: branch,
      owner: origin.owner,
      repository: `${origin.owner}/${origin.repository}`,
    })
    if (!result.ok) continue
    const originKey = sourceControlRepositoryKey(origin)
    const reference = sourceControlRepositoryReference(target)
    if (settings.sourceControlChangeRequestRepositories[originKey] !== reference) {
      await access.patch({ sourceControlChangeRequestRepositories: { [originKey]: reference } })
    }
    return { result, provider, repository: target }
  }
  return fallback
}
