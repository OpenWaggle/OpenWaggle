import type { WorkingPath } from '@shared/types/brand'
import type { GitStatusSummary, VcsStatus } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import { sanitizeFeatureBranchName } from '@shared/utils/git-stacked-action'
import type { getChangeRequestTerminology } from '@shared/utils/source-control-presentation'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'
import { invalidateSessionResourceQueries } from '../hooks/useSessionResources'
import {
  changeRequestActionInput,
  changeRequestPreflightPayload,
  changeRequestStatusReadinessMessage,
  emptyFeatureBranchValidationMessage,
} from './change-request-composer-model'
import {
  type CreatedRequest,
  createdToast,
  creationError,
  outputRecordingError,
  resolveChangeRequestComposerOutcome,
  startsOnDefaultRef,
} from './change-request-composer-outcome'
import { useChangeRequestPreflight } from './use-change-request-preflight'

export interface ChangeRequestComposerProps {
  readonly session: SessionDetail
  readonly workingPath: WorkingPath
  readonly gitStatus: GitStatusSummary | null
  readonly vcsStatus: VcsStatus | null
  readonly onClose: () => void
  readonly onCompleted: () => void
}

type Terminology = ReturnType<typeof getChangeRequestTerminology>

function showCreatedToast(
  showToast: ReturnType<typeof useUIStore.getState>['showToast'],
  shortLabel: string,
  commitOutputMessage: string | null,
) {
  const toast = createdToast(shortLabel, commitOutputMessage)
  showToast(toast.message, toast.variant)
}

async function addCreatedRequestToOutputs(
  props: ChangeRequestComposerProps,
  request: CreatedRequest,
  queryClient: QueryClient,
) {
  await api.recordSessionChangeRequest(props.session.id, request)
  await invalidateSessionResourceQueries(queryClient, String(props.session.id))
  props.onClose()
}

interface ChangeRequestActionState {
  readonly props: ChangeRequestComposerProps
  readonly terminology: Terminology
  readonly title: string
  readonly description: string
  readonly branchName: string
  readonly commitAndPush: boolean
  readonly createFeatureBranch: boolean
  readonly running: boolean
  readonly creationBlocked: boolean
  readonly createdRequest: CreatedRequest | null
  readonly pendingResourceRecord: CreatedRequest | null
  readonly setRunning: (value: boolean) => void
  readonly setError: (value: string | null) => void
  readonly setFallbackUrl: (value: string | null) => void
  readonly setCreatedRequest: (value: CreatedRequest | null) => void
  readonly setRetryAuthorized: (value: boolean) => void
  readonly setBranchName: (value: string) => void
}

function useChangeRequestActions(state: ChangeRequestActionState) {
  const queryClient = useQueryClient()
  const showToast = useUIStore((value) => value.showToast)

  async function recordCreatedRequest(request: CreatedRequest) {
    state.setRunning(true)
    state.setError(null)
    try {
      await addCreatedRequestToOutputs(state.props, request, queryClient)
    } catch {
      state.setCreatedRequest(request)
      state.setRetryAuthorized(true)
      state.setFallbackUrl(request.url)
      state.setError(outputRecordingError(state.terminology.shortLabel))
    } finally {
      state.setRunning(false)
    }
  }

  async function create(draft: boolean) {
    if (state.running || state.createdRequest || state.creationBlocked) return
    state.setRunning(true)
    state.setError(null)
    state.setFallbackUrl(null)
    try {
      const result = await api.runStackedGitAction(
        state.props.workingPath,
        changeRequestActionInput({
          session: state.props.session,
          gitStatus: state.props.gitStatus,
          vcsStatus: state.props.vcsStatus,
          title: state.title,
          description: state.description,
          branchName: state.branchName,
          commitAndPush: state.commitAndPush,
          createFeatureBranch: state.createFeatureBranch,
          draft,
        }),
      )
      const outcome = resolveChangeRequestComposerOutcome(result)
      if (outcome.kind === 'failed') {
        if (outcome.branchName) state.setBranchName(outcome.branchName)
        state.setFallbackUrl(outcome.fallbackUrl)
        state.setError(outcome.message)
        return
      }
      if (outcome.kind === 'request-output-failed') {
        state.setFallbackUrl(outcome.request.url)
        state.props.onCompleted()
        state.setCreatedRequest(outcome.request)
        state.setRetryAuthorized(outcome.retryPersisted)
        state.setError(outcome.message)
        return
      }
      if (outcome.kind === 'created-request') {
        state.setFallbackUrl(outcome.request.url)
        state.props.onCompleted()
        await invalidateSessionResourceQueries(queryClient, String(state.props.session.id))
        showCreatedToast(showToast, state.terminology.shortLabel, outcome.commitOutputMessage)
        state.props.onClose()
        return
      }
      showCreatedToast(showToast, state.terminology.shortLabel, outcome.commitOutputMessage)
      state.props.onCompleted()
      state.props.onClose()
    } catch (cause) {
      state.setError(creationError(cause, state.terminology.shortLabel))
    } finally {
      state.setRunning(false)
    }
  }

  return {
    create,
    retryResourceRecord: () => {
      if (state.pendingResourceRecord && !state.running) {
        void recordCreatedRequest(state.pendingResourceRecord)
      }
    },
  }
}

export function useChangeRequestComposer(
  props: ChangeRequestComposerProps,
  terminology: Terminology,
) {
  const [title, setTitle] = useState(props.session.title)
  const [description, setDescription] = useState('')
  const [commitAndPush, setCommitAndPush] = useState((props.gitStatus?.filesChanged ?? 0) > 0)
  const [createFeatureBranch] = useState(() => startsOnDefaultRef(props.vcsStatus))
  const [requestedBranchName, setBranchName] = useState(() =>
    sanitizeFeatureBranchName(`codex/${props.session.title}`),
  )
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)
  const [createdRequest, setCreatedRequest] = useState<CreatedRequest | null>(null)
  const [retryAuthorized, setRetryAuthorized] = useState(false)
  const pendingResourceRecord = retryAuthorized ? createdRequest : null
  const statusReadinessError = changeRequestStatusReadinessMessage(props, terminology.singular)
  const fieldValidationError = emptyFeatureBranchValidationMessage(
    {
      commitAndPush,
      createFeatureBranch,
      gitStatus: props.gitStatus,
      vcsStatus: props.vcsStatus,
    },
    terminology.singular,
  )
  const validationError = statusReadinessError ?? fieldValidationError
  const preflight = useChangeRequestPreflight(
    String(props.session.id),
    props.workingPath,
    props.vcsStatus?.sourceControlProvider?.id,
    changeRequestPreflightPayload({
      ...props,
      title,
      description,
      branchName: requestedBranchName,
      commitAndPush,
      createFeatureBranch,
      draft: false,
    }),
    statusReadinessError,
  )
  const branchName = preflight.plannedHeadRef ?? requestedBranchName
  const creationBlocked =
    validationError !== null ||
    createdRequest !== null ||
    preflight.nativeCreationBlocked ||
    (createFeatureBranch && branchName.trim().length === 0)
  function updateField<T>(setter: (value: T) => void, value: T) {
    if (running || createdRequest) return
    setFallbackUrl(null)
    setter(value)
  }
  const actions = useChangeRequestActions({
    props,
    terminology,
    title,
    description,
    branchName,
    commitAndPush,
    createFeatureBranch,
    running,
    creationBlocked,
    createdRequest,
    pendingResourceRecord,
    setRunning,
    setError,
    setFallbackUrl,
    setCreatedRequest,
    setRetryAuthorized,
    setBranchName,
  })

  return {
    title,
    setTitle: (value: string) => updateField(setTitle, value),
    description,
    setDescription: (value: string) => updateField(setDescription, value),
    commitAndPush,
    setCommitAndPush: (value: boolean) => updateField(setCommitAndPush, value),
    createFeatureBranch,
    branchName,
    setBranchName: (value: string) => updateField(setBranchName, value),
    running,
    error: fieldValidationError ?? error,
    creationBlocked,
    fallbackUrl,
    pendingResourceRecord,
    requestCreated: createdRequest !== null,
    preflight,
    ...actions,
  }
}
