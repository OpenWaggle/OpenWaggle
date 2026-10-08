import type {
  GitRunStackedActionOptions,
  GitStackedActionBranchOutcome,
  OpenChangeRequestPayload,
} from '@shared/types/git'
import type { RemoteUrlRepository } from '../../services/source-control/working-tree-source-control'
import type { GitPushDestination } from './push-service'

interface ChangeRequestRefDeps {
  readonly resolveCurrentRef: (projectPath: string) => Promise<string | null>
  readonly resolveDefaultBaseRef: (projectPath: string) => Promise<string | null>
  readonly resolvePrimaryRemoteUrl: (projectPath: string) => Promise<string | null>
  /** The repository behind a remote URL, decided by the shared source-control resolver. */
  readonly resolveRemoteRepository: (
    projectPath: string,
    remoteUrl: string,
  ) => Promise<RemoteUrlRepository | null>
}

async function resolveHeadRef(
  deps: ChangeRequestRefDeps,
  projectPath: string,
  branch: GitStackedActionBranchOutcome,
  destination: GitPushDestination | undefined,
) {
  const candidate =
    destination?.branch ?? branch.name ?? (await deps.resolveCurrentRef(projectPath))
  return candidate?.trim() || null
}

async function resolveBaseRef(
  deps: ChangeRequestRefDeps,
  projectPath: string,
  options: GitRunStackedActionOptions,
) {
  const candidate = options.baseRef ?? (await deps.resolveDefaultBaseRef(projectPath))
  return candidate?.trim() || undefined
}

async function compatibleHeadIdentity(
  deps: ChangeRequestRefDeps,
  projectPath: string,
  baseUrl: string | null,
  destination: GitPushDestination,
): Promise<Pick<
  OpenChangeRequestPayload,
  'headOwner' | 'headRepository' | 'targetRepository'
> | null> {
  if (destination.multiplePushUrls || !destination.remoteUrl || !baseUrl) return null
  const [resolvedBase, resolvedHead] = await Promise.all([
    deps.resolveRemoteRepository(projectPath, baseUrl),
    deps.resolveRemoteRepository(projectPath, destination.remoteUrl),
  ])
  if (!resolvedBase || !resolvedHead) return null
  const base = resolvedBase.repository
  const head = resolvedHead.repository
  if (base.provider !== head.provider || base.host !== head.host) return null
  if (resolvedBase.authority !== resolvedHead.authority) return null
  const targetRepository = {
    provider: base.provider,
    host: base.host,
    owner: base.owner,
    repository: base.repository,
  }
  const sameOwner = base.owner.toLowerCase() === head.owner.toLowerCase()
  const sameRepository = base.repository.toLowerCase() === head.repository.toLowerCase()
  if (sameOwner && sameRepository) return { targetRepository }
  if (base.provider === 'gitlab') {
    return { targetRepository, headRepository: `${head.owner}/${head.repository}` }
  }
  if (sameOwner) return null
  return {
    targetRepository,
    headOwner: head.owner,
    headRepository: `${head.owner}/${head.repository}`,
  }
}

export async function buildOpenChangeRequestPayload(
  deps: ChangeRequestRefDeps,
  projectPath: string,
  options: GitRunStackedActionOptions,
  branch: GitStackedActionBranchOutcome,
  pushDestination: GitPushDestination | undefined,
): Promise<OpenChangeRequestPayload | null> {
  const headRef = await resolveHeadRef(deps, projectPath, branch, pushDestination)
  if (!headRef) return null

  const [baseRef, primaryRemoteUrl] = await Promise.all([
    resolveBaseRef(deps, projectPath, options),
    deps.resolvePrimaryRemoteUrl(projectPath),
  ])
  const headIdentity = pushDestination
    ? await compatibleHeadIdentity(deps, projectPath, primaryRemoteUrl, pushDestination)
    : {}
  if (headIdentity === null) return null
  return {
    headRef,
    ...headIdentity,
    ...(baseRef ? { baseRef } : {}),
    title: options.changeRequestTitle?.trim() || 'Update',
    body: options.changeRequestBody,
    draft: options.draft,
  }
}
