import {
  type SourceControlAttention,
  type SourceControlHostState,
  type SourceControlHostsOverview,
  sourceControlCliForProvider,
  sourceControlRepositoryKey,
} from '@shared/types/source-control'
import type { SourceControlRemoteResolution } from '../../services/source-control/source-control-remote-resolution'
import type { SourceControlSettingsAccess } from '../../services/source-control/source-control-settings-access'
import type { WorkingTreeSourceControl } from '../../services/source-control/working-tree-source-control'
import type { SourceControlToolBackend } from './source-control-tool-backend'
import { attentionNextStep } from './source-control-tool-guidance'
import { redactRemoteUrl, redactSourceControlText } from './source-control-tool-redaction'

/** The Session's working tree and the project root whose settings apply to it. */
export interface SourceControlToolScope {
  readonly workingPath: string
  readonly projectRoot: string
}

function hostTooling(
  hostState: SourceControlHostState | null,
  overview: SourceControlHostsOverview | null,
) {
  if (!hostState) return { cli: null, accounts: [] }
  const entry = overview?.hosts.find((candidate) => candidate.host === hostState.host)
  const cli =
    entry?.cli ?? (hostState.provider ? sourceControlCliForProvider(hostState.provider) : null)
  return {
    // Unknown, not false, when the host list could not be read.
    cli: cli ? { name: cli, installed: overview ? overview.cliInstalled[cli] : null } : null,
    accounts: entry?.accounts ?? [],
  }
}

/** Run one read; a failure is recorded, redacted, and the status carries on without it. */
async function attempt<T>(errors: string[], label: string, read: () => Promise<T>) {
  try {
    return await read()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    errors.push(`${label}: ${redactSourceControlText(message)}`)
    return null
  }
}

const NO_LOOKUP = { branch: null, changeRequest: null, attention: null, error: null } as const

/** The current branch's change request, or the attention that stops it being found. */
async function lookUpChangeRequest(
  sourceControl: WorkingTreeSourceControl | null,
  workingPath: string,
  access: SourceControlSettingsAccess,
  backend: SourceControlToolBackend,
) {
  const branch = await backend.currentBranch(workingPath)
  if (!sourceControl || !branch) return { ...NO_LOOKUP, branch }
  const current = await backend.findCurrentChangeRequest(sourceControl, workingPath, branch, access)
  if (current.result.ok) {
    const { url, title, state } = current.result.changeRequest
    return {
      ...NO_LOOKUP,
      branch,
      changeRequest: { url, title, state, account: current.provider.account() },
    }
  }
  const attention = backend.attentionForFailure(current.result, sourceControl.info)
  const unexplained = !attention && current.result.code !== 'no-change-request'
  return {
    ...NO_LOOKUP,
    branch,
    attention,
    error: unexplained ? redactSourceControlText(current.result.message) : null,
  }
}

/** What the remote resolution says, with credentials removed from the remote URL. */
function resolutionView(resolution: SourceControlRemoteResolution | null) {
  if (!resolution || resolution.kind === 'no-remote') {
    return { remote: null, hostState: null, repository: null, attention: null }
  }
  const remote = { name: resolution.remote.name, url: redactRemoteUrl(resolution.remote.url) }
  if (resolution.kind === 'unrecognised-remote') {
    return { remote, hostState: null, repository: null, attention: null }
  }
  return {
    remote,
    hostState: resolution.hostState,
    repository:
      resolution.kind === 'resolved' ? sourceControlRepositoryKey(resolution.repository) : null,
    attention: resolution.attention,
  }
}

/** Compact, token-free diagnosis of the Session's source control; partial when a read fails. */
export async function readSourceControlStatus(
  scope: SourceControlToolScope,
  backend: SourceControlToolBackend,
) {
  const access = backend.access()
  const errors: string[] = []
  const [opened, overview, settings, openDestination] = await Promise.all([
    attempt(errors, 'remote', () =>
      backend.openWorkingTree(scope.workingPath, access, {
        probeRemote: true,
        projectPath: scope.projectRoot,
      }),
    ),
    attempt(errors, 'hosts', () => backend.listHosts(access)),
    attempt(errors, 'settings', () => access.read()),
    attempt(errors, 'open destination', () =>
      backend.resolveOpenDestination(scope.projectRoot, access),
    ),
  ])
  const {
    remote,
    hostState,
    repository,
    attention: offline,
  } = resolutionView(opened?.resolution ?? null)
  const lookup =
    (await attempt(errors, 'change request', () =>
      lookUpChangeRequest(opened?.sourceControl ?? null, scope.workingPath, access, backend),
    )) ?? NO_LOOKUP
  const attention: SourceControlAttention | null = offline ?? lookup.attention
  return {
    remote,
    host: hostState,
    repository,
    ...hostTooling(hostState, overview),
    rememberedAccount: repository
      ? (settings?.sourceControlRepositoryAccounts[repository] ?? null)
      : null,
    branch: lookup.branch,
    changeRequest: lookup.changeRequest,
    ...(lookup.error ? { changeRequestError: lookup.error } : {}),
    attention,
    nextStep: attentionNextStep(attention),
    openDestination,
    ...(errors.length > 0 ? { error: errors.join('; ') } : {}),
  }
}
