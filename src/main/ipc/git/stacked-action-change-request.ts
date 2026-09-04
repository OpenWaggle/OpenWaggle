import type {
  GitRunStackedActionOptions,
  GitStackedActionBranchOutcome,
  OpenChangeRequestPayload,
} from '@shared/types/git'
import type { GitPushDestination } from './push-service'
import { detectSourceControlProvider, parseRemoteRepositoryIdentity } from './vcs-status-parse'

interface ChangeRequestRefDeps {
  readonly resolveCurrentRef: (projectPath: string) => Promise<string | null>
  readonly resolveDefaultBaseRef: (projectPath: string) => Promise<string | null>
  readonly resolvePrimaryRemoteUrl: (projectPath: string) => Promise<string | null>
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

function compatibleHeadIdentity(
  baseUrl: string | null,
  destination: GitPushDestination,
): Pick<OpenChangeRequestPayload, 'headOwner' | 'headRepository'> | null {
  if (destination.multiplePushUrls || !destination.remoteUrl || !baseUrl) return null
  const base = parseRemoteRepositoryIdentity(baseUrl)
  if (!base) return detectSourceControlProvider(baseUrl) ? null : {}
  const head = parseRemoteRepositoryIdentity(destination.remoteUrl)
  if (!head || base.provider !== head.provider) return null
  if (base.authority !== head.authority) return null
  const sameOwner = base.owner.toLowerCase() === head.owner.toLowerCase()
  const sameRepository = base.repository.toLowerCase() === head.repository.toLowerCase()
  if (sameOwner && sameRepository) return {}
  if (base.provider === 'gitlab') {
    return { headRepository: `${head.owner}/${head.repository}` }
  }
  return sameOwner ? null : { headOwner: head.owner }
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
    ? compatibleHeadIdentity(primaryRemoteUrl, pushDestination)
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
