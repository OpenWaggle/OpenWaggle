import type {
  SourceControlFailure,
  SourceControlProviderInfo,
  SourceControlRepositoryIdentity,
} from '@shared/types/change-request'
import {
  type SourceControlAttention,
  type SourceControlHostState,
  sourceControlCliForProvider,
  sourceControlRepositoryKey,
} from '@shared/types/source-control'
import { getSourceControlProvider } from '../../adapters/source-control'
import type { SourceControlProvider } from '../../ports/source-control-provider'
import { createLiveSourceControlResolutionDeps } from './live-resolution-deps'
import { projectSettingsKey } from './project-root'
import { parseRemoteLocation } from './remote-location'
import { ignoredSourceControlTokenVariables } from './source-control-environment'
import {
  resolveSourceControlRemote,
  type SourceControlRemote,
  type SourceControlRemoteResolution,
  type SourceControlRemoteResolutionDeps,
} from './source-control-remote-resolution'
import {
  resolutionPreferences,
  type SourceControlSettingsAccess,
} from './source-control-settings-access'

/** A working tree's resolved repository with a provider bound to its remembered account. */
export interface WorkingTreeSourceControl {
  readonly remote: SourceControlRemote
  readonly repository: SourceControlRepositoryIdentity
  readonly hostState: SourceControlHostState
  readonly info: SourceControlProviderInfo
  readonly provider: SourceControlProvider
  /** Web address of the repository, e.g. `https://git.acme.io/group/app`. */
  readonly webUrl: string
}

export interface WorkingTreeSourceControlResult {
  readonly resolution: SourceControlRemoteResolution
  readonly sourceControl: WorkingTreeSourceControl | null
}

export interface OpenSourceControlOptions {
  readonly probeRemote?: boolean
  /** Project root whose declarations apply; derived from the working tree when omitted. */
  readonly projectPath?: string | null
  readonly deps?: SourceControlRemoteResolutionDeps
}

export function repositoryWebUrlFor(repository: SourceControlRepositoryIdentity) {
  return `https://${repository.host}/${repository.owner}/${repository.repository}`
}

/** A provider for one repository that reads and remembers its Provider account. */
export function providerForRepository(
  repository: SourceControlRepositoryIdentity,
  access: SourceControlSettingsAccess,
  preferredLogin: string | null,
): SourceControlProvider | null {
  const key = sourceControlRepositoryKey(repository)
  return getSourceControlProvider(repository.provider, repository, {
    accountPreference: {
      preferredLogin,
      remember: async (login) => {
        const current = (await access.read()).sourceControlRepositoryAccounts
        if (current[key] === login) return
        await access.patch({ sourceControlRepositoryAccounts: { [key]: login } })
      },
    },
  })
}

/** {@link providerForRepository} with the Provider account remembered for the repository. */
export async function rememberingProviderForRepository(
  repository: SourceControlRepositoryIdentity,
  access: SourceControlSettingsAccess,
): Promise<SourceControlProvider | null> {
  const settings = await access.read()
  const preferred = settings.sourceControlRepositoryAccounts[sourceControlRepositoryKey(repository)]
  return providerForRepository(repository, access, preferred ?? null)
}

/**
 * Resolve the Source control host and repository behind a working tree and bind a provider CLI
 * adapter to it (ADR 0048). Every caller goes through this one path so the Session Summary, the
 * Change request inspector, and the agent tool give the same answer.
 */
export async function openWorkingTreeSourceControl(
  workingPath: string,
  access: SourceControlSettingsAccess,
  options: OpenSourceControlOptions = {},
): Promise<WorkingTreeSourceControlResult> {
  const deps = options.deps ?? createLiveSourceControlResolutionDeps(resolutionPreferences(access))
  const resolution = await resolveSourceControlRemote(
    {
      workingPath,
      projectPath:
        options.projectPath === undefined
          ? await projectSettingsKey(workingPath)
          : options.projectPath,
      probeRemote: options.probeRemote ?? false,
    },
    deps,
  )
  if (resolution.kind !== 'resolved') return { resolution, sourceControl: null }
  const provider = await rememberingProviderForRepository(resolution.repository, access)
  if (!provider) return { resolution, sourceControl: null }
  return {
    resolution,
    sourceControl: {
      remote: resolution.remote,
      repository: resolution.repository,
      hostState: resolution.hostState,
      info: { id: resolution.repository.provider, host: resolution.repository.host },
      provider,
      webUrl: repositoryWebUrlFor(resolution.repository),
    },
  }
}

/** A remote URL's repository, plus the server address it names, for push-target checks. */
export interface RemoteUrlRepository {
  readonly repository: SourceControlRepositoryIdentity
  readonly authority: string
}

/**
 * Resolve any remote URL of a working tree (for example a push destination) through the same
 * provider decision as its primary remote, without probing the network.
 */
export async function resolveRemoteUrlRepository(
  workingPath: string,
  remoteUrl: string,
  deps: SourceControlRemoteResolutionDeps,
  projectPath: string | null,
): Promise<RemoteUrlRepository | null> {
  const location = parseRemoteLocation(remoteUrl)
  if (!location) return null
  const resolution = await resolveSourceControlRemote(
    { workingPath, projectPath, probeRemote: false },
    { ...deps, readPrimaryRemote: async () => ({ name: 'origin', url: remoteUrl }) },
  )
  return resolution.kind === 'resolved'
    ? { repository: resolution.repository, authority: location.authority }
    : null
}

/** {@link resolveRemoteUrlRepository} with the live resolver and settings. */
export async function resolveLiveRemoteUrlRepository(
  workingPath: string,
  remoteUrl: string,
  access: SourceControlSettingsAccess,
) {
  return resolveRemoteUrlRepository(
    workingPath,
    remoteUrl,
    createLiveSourceControlResolutionDeps(resolutionPreferences(access)),
    await projectSettingsKey(workingPath),
  )
}

/** The fix for a CLI failure, when it has one the user can act on. */
export function attentionForFailure(
  failure: SourceControlFailure,
  info: SourceControlProviderInfo,
): SourceControlAttention | null {
  if (failure.attention) return failure.attention
  const cli = sourceControlCliForProvider(info.id)
  if (failure.code === 'cli-missing') {
    return { kind: 'cli-missing', provider: info.id, host: info.host, cli }
  }
  if (failure.code === 'not-authenticated') {
    const ignoredTokenVariables = ignoredSourceControlTokenVariables(info.id)
    return {
      kind: 'not-signed-in',
      provider: info.id,
      host: info.host,
      cli,
      environmentTokenIgnored: ignoredTokenVariables.length > 0,
      ignoredTokenVariables,
    }
  }
  return null
}

export function withAttention(
  failure: SourceControlFailure,
  info: SourceControlProviderInfo,
): SourceControlFailure {
  const attention = attentionForFailure(failure, info)
  return attention ? { ...failure, attention } : failure
}
