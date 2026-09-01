import type { WorkingPath } from '@shared/types/brand'
import type { GitStatusSummary, VcsStatus } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import { sanitizeFeatureBranchName } from '@shared/utils/git-stacked-action'
import { getChangeRequestTerminology } from '@shared/utils/source-control-presentation'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { useUIStore } from '@/shell/ui-store'
import { sessionResourcesQueryKey } from '../hooks/useSessionResources'
import { ChangeRequestComposerActions } from './ChangeRequestComposerActions'
import { ChangeRequestFields } from './ChangeRequestFields'
import {
  changeRequestActionInput,
  emptyFeatureBranchValidationMessage,
} from './change-request-composer-model'

interface ChangeRequestComposerProps {
  readonly session: SessionDetail
  readonly workingPath: WorkingPath
  readonly gitStatus: GitStatusSummary | null
  readonly vcsStatus: VcsStatus | null
  readonly onClose: () => void
  readonly onCompleted: () => void
}

interface CreatedRequest {
  readonly title: string
  readonly url: string
}

function startsOnDefaultRef(status: VcsStatus | null) {
  return status?.defaultRef != null && status.refName === status.defaultRef
}

function runComposerAction(
  props: ChangeRequestComposerProps,
  input: {
    readonly title: string
    readonly description: string
    readonly branchName: string
    readonly commitAndPush: boolean
    readonly createFeatureBranch: boolean
    readonly draft: boolean
  },
) {
  return api.runStackedGitAction(
    props.workingPath,
    changeRequestActionInput({ ...props, ...input }),
  )
}

function outputRecordingError(shortLabel: string) {
  return `${shortLabel} was created, but it could not be added to this session's Outputs. Retry adding it without creating another ${shortLabel}.`
}

async function addCreatedRequestToOutputs(
  props: ChangeRequestComposerProps,
  request: CreatedRequest,
  queryClient: QueryClient,
) {
  await api.recordSessionChangeRequest(props.session.id, request)
  await queryClient.invalidateQueries({
    queryKey: sessionResourcesQueryKey(String(props.session.id)),
  })
  void api.openExternal(request.url)
  props.onClose()
}

function useChangeRequestComposer(
  props: ChangeRequestComposerProps,
  terminology: ReturnType<typeof getChangeRequestTerminology>,
) {
  const [title, setTitle] = useState(props.session.title)
  const [description, setDescription] = useState('')
  const [commitAndPush, setCommitAndPush] = useState((props.gitStatus?.filesChanged ?? 0) > 0)
  const [createFeatureBranch] = useState(() => startsOnDefaultRef(props.vcsStatus))
  const [branchName, setBranchName] = useState(() =>
    sanitizeFeatureBranchName(`codex/${props.session.title}`),
  )
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)
  const [pendingResourceRecord, setPendingResourceRecord] = useState<CreatedRequest | null>(null)
  const showToast = useUIStore((state) => state.showToast)
  const queryClient = useQueryClient()
  const validationError = emptyFeatureBranchValidationMessage(
    { commitAndPush, createFeatureBranch, gitStatus: props.gitStatus, vcsStatus: props.vcsStatus },
    terminology.singular,
  )

  function updateField<T>(setter: (value: T) => void, value: T) {
    if (pendingResourceRecord) return
    setFallbackUrl(null)
    setter(value)
  }

  async function recordCreatedRequest(request: CreatedRequest) {
    setRunning(true)
    setError(null)
    try {
      await addCreatedRequestToOutputs(props, request, queryClient)
    } catch {
      setPendingResourceRecord(request)
      setFallbackUrl(request.url)
      setError(outputRecordingError(terminology.shortLabel))
    } finally {
      setRunning(false)
    }
  }

  async function create(draft: boolean) {
    if (
      running ||
      pendingResourceRecord ||
      validationError ||
      (createFeatureBranch && branchName.trim().length === 0)
    )
      return
    setRunning(true)
    setError(null)
    setFallbackUrl(null)
    try {
      const result = await runComposerAction(props, {
        title,
        description,
        branchName,
        commitAndPush,
        createFeatureBranch,
        draft,
      })
      if (!result.ok) {
        if (result.branch?.name) setBranchName(result.branch.name)
        setFallbackUrl(result.fallbackUrl ?? null)
        setError(result.message)
        return
      }
      showToast(`${terminology.shortLabel} created.`, 'success')
      if (result.changeRequest) {
        const request = {
          title: result.changeRequest.title,
          url: result.changeRequest.url,
        }
        setFallbackUrl(request.url)
        props.onCompleted()
        if (result.changeRequestOutput?.ok === false) {
          setPendingResourceRecord(request)
          setError(outputRecordingError(terminology.shortLabel))
          return
        }
        await queryClient.invalidateQueries({
          queryKey: sessionResourcesQueryKey(String(props.session.id)),
        })
        void api.openExternal(request.url)
        props.onClose()
        return
      }
      props.onCompleted()
      props.onClose()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : `Could not create ${terminology.shortLabel}.`,
      )
    } finally {
      setRunning(false)
    }
  }

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
    error: validationError ?? error,
    creationBlocked: validationError !== null || pendingResourceRecord !== null,
    fallbackUrl,
    pendingResourceRecord,
    create,
    retryResourceRecord: () => {
      if (pendingResourceRecord && !running) void recordCreatedRequest(pendingResourceRecord)
    },
  }
}

function resolveBrowserUrl(fallbackUrl: string | null, vcsStatus: VcsStatus | null) {
  return fallbackUrl ?? vcsStatus?.changeRequest?.url ?? null
}

export function ChangeRequestComposer(props: ChangeRequestComposerProps) {
  const terminology = getChangeRequestTerminology(props.vcsStatus?.sourceControlProvider?.id)
  const composer = useChangeRequestComposer(props, terminology)
  const browserUrl = resolveBrowserUrl(composer.fallbackUrl, props.vcsStatus)
  const retryButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (composer.pendingResourceRecord && !composer.running && composer.error) {
      retryButtonRef.current?.focus()
    }
  }, [composer.error, composer.pendingResourceRecord, composer.running])
  const close = () => {
    if (!composer.running) props.onClose()
  }

  return (
    <ModalDialog
      label={`Create ${terminology.singular}`}
      onClose={close}
      dismissible={!composer.running}
    >
      <form
        aria-busy={composer.running}
        onSubmit={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (
            event.key !== 'Enter' ||
            (!event.metaKey && !event.ctrlKey) ||
            event.nativeEvent.isComposing ||
            composer.running ||
            composer.creationBlocked ||
            (composer.createFeatureBranch && composer.branchName.trim().length === 0)
          ) {
            return
          }
          event.preventDefault()
          void composer.create(false)
        }}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm text-text-tertiary">
              {composer.createFeatureBranch
                ? 'New branch'
                : (props.vcsStatus?.refName ?? 'Current ref')}{' '}
              →{' '}
              {props.vcsStatus?.changeRequest?.baseRef ??
                props.vcsStatus?.defaultRef ??
                'default branch'}
            </p>
            <h2 className="truncate text-sm font-semibold text-text-primary">
              Create {terminology.singular}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close change request composer"
            disabled={composer.running}
            onClick={close}
          >
            <X className="size-4" />
          </Button>
        </header>
        <ChangeRequestFields
          model={{
            createFeatureBranch: composer.createFeatureBranch,
            branchName: composer.branchName,
            title: composer.title,
            description: composer.description,
            commitAndPush: composer.commitAndPush,
            gitStatus: props.gitStatus,
            error: composer.error,
            disabled: composer.pendingResourceRecord !== null,
            onBranchNameChange: composer.setBranchName,
            onTitleChange: composer.setTitle,
            onDescriptionChange: composer.setDescription,
            onCommitAndPushChange: composer.setCommitAndPush,
          }}
        />
        <p className="sr-only" role="status" aria-live="polite">
          {composer.running
            ? composer.pendingResourceRecord
              ? `Adding ${terminology.shortLabel} to Outputs…`
              : `Creating ${terminology.shortLabel}…`
            : ''}
        </p>
        <ChangeRequestComposerActions
          model={{
            terminology,
            running: composer.running,
            branchMissing:
              composer.creationBlocked ||
              (composer.createFeatureBranch && composer.branchName.trim().length === 0),
            onCreate: (draft) => void composer.create(draft),
            pendingResourceRecord: composer.pendingResourceRecord !== null,
            onRetryResourceRecord: composer.retryResourceRecord,
            retryButtonRef,
            browserUrl,
            onOpenBrowser: () => {
              if (browserUrl) void api.openExternal(browserUrl)
            },
          }}
        />
      </form>
    </ModalDialog>
  )
}
