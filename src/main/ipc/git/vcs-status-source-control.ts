import type {
  LocalVcsStatus,
  SourceControlAttention,
  SourceControlHostState,
  SourceControlProviderInfo,
  VcsChangeRequest,
} from '@shared/types/git'
import { createLogger } from '../../logger'
import type { PrimaryRemote } from '../../services/git/primary-remote'
import { findCurrentChangeRequest } from '../../services/source-control/fork-change-requests'
import { sourceControlSettingsAccess } from '../../services/source-control/source-control-runtime'
import {
  attentionForFailure,
  openWorkingTreeSourceControl,
  repositoryWebUrlFor,
} from '../../services/source-control/working-tree-source-control'

interface OpenChangeRequestState {
  readonly changeRequest: VcsChangeRequest | null
  readonly changeRequestAttention: SourceControlAttention | null
  readonly changeRequestAccount: string | null
  readonly sourceControlProvider?: SourceControlProviderInfo
  readonly sourceControlHost?: SourceControlHostState
}

const NO_OPEN_CHANGE_REQUEST: OpenChangeRequestState = {
  changeRequest: null,
  changeRequestAttention: null,
  changeRequestAccount: null,
}

const logger = createLogger('vcs-status-source-control')

type LocalSourceControlState = Pick<
  LocalVcsStatus,
  | 'sourceControlProvider'
  | 'sourceControlHost'
  | 'sourceControlAttention'
  | 'sourceControlRepositoryUrl'
>

const NO_LOCAL_SOURCE_CONTROL: LocalSourceControlState = {
  sourceControlProvider: null,
  sourceControlHost: null,
  sourceControlAttention: null,
  sourceControlRepositoryUrl: null,
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Offline source-control state for the Local VCS status: never probes the remote, and never
 * fails the status, since branch and working-tree state do not depend on it.
 */
export async function localSourceControlState(
  projectPath: string,
  primaryRemote: PrimaryRemote | null,
): Promise<LocalSourceControlState> {
  if (!primaryRemote) return NO_LOCAL_SOURCE_CONTROL
  try {
    return await resolveLocalSourceControlState(projectPath)
  } catch (error) {
    logger.warn('Could not resolve the source-control host for a working tree', {
      error: errorMessage(error),
    })
    return NO_LOCAL_SOURCE_CONTROL
  }
}

async function resolveLocalSourceControlState(
  projectPath: string,
): Promise<LocalSourceControlState> {
  const none = NO_LOCAL_SOURCE_CONTROL
  const { resolution } = await openWorkingTreeSourceControl(
    projectPath,
    sourceControlSettingsAccess(),
    { probeRemote: false },
  )
  if (resolution.kind === 'resolved') {
    return {
      sourceControlProvider: {
        id: resolution.repository.provider,
        host: resolution.repository.host,
      },
      sourceControlHost: resolution.hostState,
      sourceControlAttention: resolution.attention,
      sourceControlRepositoryUrl: repositoryWebUrlFor(resolution.repository),
    }
  }
  if (resolution.kind === 'undecided') {
    return {
      ...none,
      sourceControlHost: resolution.hostState,
      sourceControlAttention: resolution.attention,
    }
  }
  return none
}

/**
 * Open change request for the current ref via the source-control provider (WS3, ADR 0048).
 * Never fails the whole remote status: provider, CLI, and auth failures become attention, and
 * anything unexpected is logged and leaves the request unknown.
 */
export async function resolveOpenChangeRequest(
  projectPath: string,
  refName: string | null,
  primaryRemote: PrimaryRemote | null,
): Promise<OpenChangeRequestState> {
  if (!refName || !primaryRemote) return NO_OPEN_CHANGE_REQUEST
  try {
    return await resolveOpenChangeRequestState(projectPath, refName)
  } catch (error) {
    logger.warn('Could not look up the open change request for a working tree', {
      error: errorMessage(error),
    })
    return NO_OPEN_CHANGE_REQUEST
  }
}

async function resolveOpenChangeRequestState(
  projectPath: string,
  refName: string,
): Promise<OpenChangeRequestState> {
  const access = sourceControlSettingsAccess()
  const { resolution, sourceControl } = await openWorkingTreeSourceControl(projectPath, access, {
    probeRemote: true,
  })
  if (resolution.kind === 'undecided') {
    return { ...NO_OPEN_CHANGE_REQUEST, changeRequestAttention: resolution.attention }
  }
  if (!sourceControl) return NO_OPEN_CHANGE_REQUEST
  const probed =
    sourceControl.hostState.source === 'remote-refs'
      ? { sourceControlProvider: sourceControl.info, sourceControlHost: sourceControl.hostState }
      : {}
  const current = await findCurrentChangeRequest(sourceControl, projectPath, refName, access)
  if (current.result.ok) {
    return {
      changeRequest: current.result.changeRequest,
      changeRequestAttention: null,
      changeRequestAccount: current.provider.account(),
      ...probed,
    }
  }
  return {
    ...NO_OPEN_CHANGE_REQUEST,
    changeRequestAttention: attentionForFailure(current.result, sourceControl.info),
    ...probed,
  }
}
