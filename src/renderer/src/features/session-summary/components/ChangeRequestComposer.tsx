import type { WorkingPath } from '@shared/types/brand'
import type { GitRunStackedActionResult, GitStatusSummary, VcsStatus } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import type { RecordSessionCommitInput } from '@shared/types/session-resource'
import { sanitizeFeatureBranchName } from '@shared/utils/git-stacked-action'
import { getChangeRequestTerminology } from '@shared/utils/source-control-presentation'
import { useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { useUIStore } from '@/shell/ui-store'
import { sessionResourcesQueryKey, useRecordSessionCommit } from '../hooks/useSessionResources'
import { ChangeRequestComposerActions } from './ChangeRequestComposerActions'
import { ChangeRequestFields } from './ChangeRequestFields'
import {
  changeRequestActionInput,
  changeRequestPreflightPayload,
  emptyFeatureBranchValidationMessage,
} from './change-request-composer-model'
import { useChangeRequestPreflight } from './use-change-request-preflight'

interface ChangeRequestComposerProps {
  readonly session: SessionDetail
  readonly workingPath: WorkingPath
  readonly gitStatus: GitStatusSummary | null
  readonly vcsStatus: VcsStatus | null
  readonly onClose: () => void
  readonly onCompleted: () => void
}

async function recordCreatedCommit(
  result: GitRunStackedActionResult,
  title: string,
  record: (input: RecordSessionCommitInput) => Promise<void>,
) {
  if (result.commitHash) await record({ commitHash: result.commitHash, title: title.trim() })
}

function creationFailureMessage(cause: unknown, shortLabel: string) {
  return cause instanceof Error ? cause.message : `Could not create ${shortLabel}.`
}

function useChangeRequestComposer(
  props: ChangeRequestComposerProps,
  terminology: ReturnType<typeof getChangeRequestTerminology>,
) {
  const [title, setTitle] = useState(props.session.title)
  const [description, setDescription] = useState('')
  const [commitAndPush, setCommitAndPush] = useState((props.gitStatus?.filesChanged ?? 0) > 0)
  const [createFeatureBranch] = useState(
    props.vcsStatus?.defaultRef != null && props.vcsStatus.refName === props.vcsStatus.defaultRef,
  )
  const [branchName, setBranchName] = useState(() =>
    sanitizeFeatureBranchName(`codex/${props.session.title}`),
  )
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)
  const showToast = useUIStore((state) => state.showToast)
  const queryClient = useQueryClient()
  const recordSessionCommit = useRecordSessionCommit(props.session.id, queryClient)
  const validationError = emptyFeatureBranchValidationMessage(
    { commitAndPush, createFeatureBranch, gitStatus: props.gitStatus, vcsStatus: props.vcsStatus },
    terminology.singular,
  )
  const preflight = useChangeRequestPreflight(
    String(props.session.id),
    props.workingPath,
    props.vcsStatus?.sourceControlProvider?.id,
    changeRequestPreflightPayload({
      ...props,
      title,
      description,
      branchName,
      commitAndPush,
      createFeatureBranch,
      draft: false,
    }),
  )
  const creationBlocked =
    validationError !== null ||
    preflight.nativeCreationBlocked ||
    (createFeatureBranch && branchName.trim().length === 0)
  async function create(draft: boolean) {
    if (running || creationBlocked) return
    setRunning(true)
    setError(null)
    setFallbackUrl(null)
    try {
      const result = await api.runStackedGitAction(
        props.workingPath,
        changeRequestActionInput({
          ...props,
          title,
          description,
          branchName,
          commitAndPush,
          createFeatureBranch,
          draft,
        }),
      )
      await recordCreatedCommit(result, title, recordSessionCommit)
      if (!result.ok) {
        if (result.branch?.name) setBranchName(result.branch.name)
        setFallbackUrl(result.fallbackUrl ?? null)
        setError(result.message)
        return
      }
      showToast(`${terminology.shortLabel} created.`, 'success')
      if (result.changeRequest) {
        await api
          .recordSessionChangeRequest(props.session.id, {
            title: result.changeRequest.title,
            url: result.changeRequest.url,
          })
          .then(() =>
            queryClient.invalidateQueries({
              queryKey: sessionResourcesQueryKey(String(props.session.id)),
            }),
          )
          .catch(() => undefined)
        void api.openExternal(result.changeRequest.url).catch(() => undefined)
      }
      props.onCompleted()
      props.onClose()
    } catch (cause) {
      setError(creationFailureMessage(cause, terminology.shortLabel))
    } finally {
      setRunning(false)
    }
  }

  return {
    title,
    setTitle: (value: string) => {
      setFallbackUrl(null)
      setTitle(value)
    },
    description,
    setDescription: (value: string) => {
      setFallbackUrl(null)
      setDescription(value)
    },
    commitAndPush,
    setCommitAndPush: (value: boolean) => {
      setFallbackUrl(null)
      setCommitAndPush(value)
    },
    createFeatureBranch,
    branchName,
    setBranchName: (value: string) => {
      setFallbackUrl(null)
      setBranchName(value)
    },
    running,
    error: validationError ?? error,
    creationBlocked,
    fallbackUrl,
    preflight,
    create,
  }
}

function resolveBrowserUrl(
  fallbackUrl: string | null,
  preflightUrl: string | null,
  vcsStatus: VcsStatus | null,
) {
  return fallbackUrl ?? vcsStatus?.changeRequest?.url ?? preflightUrl ?? null
}

export function ChangeRequestComposer(props: ChangeRequestComposerProps) {
  const terminology = getChangeRequestTerminology(props.vcsStatus?.sourceControlProvider?.id)
  const composer = useChangeRequestComposer(props, terminology)
  const browserUrl = resolveBrowserUrl(
    composer.fallbackUrl,
    composer.preflight.browserUrl,
    props.vcsStatus,
  )

  return (
    <ModalDialog
      label={`Create ${terminology.singular}`}
      dismissible={!composer.running}
      onClose={() => {
        if (!composer.running) props.onClose()
      }}
    >
      <form
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
            onClick={props.onClose}
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
            disabled: composer.running,
            onBranchNameChange: composer.setBranchName,
            onTitleChange: composer.setTitle,
            onDescriptionChange: composer.setDescription,
            onCommitAndPushChange: composer.setCommitAndPush,
          }}
        />
        <ChangeRequestComposerActions
          terminology={terminology}
          running={composer.running}
          runningLabel={`Checking prerequisites and creating ${terminology.shortLabel}…`}
          preflight={composer.preflight}
          branchMissing={
            composer.creationBlocked ||
            (composer.createFeatureBranch && composer.branchName.trim().length === 0)
          }
          onCreate={(draft) => void composer.create(draft)}
          browserUrl={browserUrl}
          onOpenBrowser={() => {
            if (browserUrl) void api.openExternal(browserUrl).catch(() => undefined)
          }}
        />
      </form>
    </ModalDialog>
  )
}
