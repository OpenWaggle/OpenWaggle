import type { WorkingPath } from '@shared/types/brand'
import type { GitStatusSummary, VcsStatus } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import { sanitizeFeatureBranchName } from '@shared/utils/git-stacked-action'
import { getChangeRequestTerminology } from '@shared/utils/source-control-presentation'
import { useQueryClient } from '@tanstack/react-query'
import { ExternalLink, GitPullRequest, X } from 'lucide-react'
import { useId, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { Checkbox } from '@/shared/ui/Checkbox'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { Textarea } from '@/shared/ui/Textarea'
import { useUIStore } from '@/shell/ui-store'
import { sessionResourcesQueryKey } from '../hooks/useSessionResources'
import { changeRequestActionInput } from './change-request-composer-model'

const DESCRIPTION_ROWS = 6

interface ChangeRequestComposerProps {
  readonly session: SessionDetail
  readonly workingPath: WorkingPath
  readonly gitStatus: GitStatusSummary | null
  readonly vcsStatus: VcsStatus | null
  readonly onClose: () => void
  readonly onCompleted: () => void
}

interface ChangeRequestFieldsModel {
  readonly createFeatureBranch: boolean
  readonly branchName: string
  readonly title: string
  readonly description: string
  readonly commitAndPush: boolean
  readonly gitStatus: GitStatusSummary | null
  readonly error: string | null
  readonly onBranchNameChange: (value: string) => void
  readonly onTitleChange: (value: string) => void
  readonly onDescriptionChange: (value: string) => void
  readonly onCommitAndPushChange: (value: boolean) => void
}

function ChangeRequestFields({ model }: { readonly model: ChangeRequestFieldsModel }) {
  const descriptionId = useId()
  return (
    <div className="space-y-4 p-4">
      {model.createFeatureBranch ? (
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-text-secondary">Branch</span>
          <input
            aria-label="New branch name"
            className="h-9 w-full rounded-md border border-border bg-bg px-3 font-mono text-sm outline-none"
            value={model.branchName}
            onChange={(event) => model.onBranchNameChange(event.target.value)}
          />
        </label>
      ) : null}
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-text-secondary">Title</span>
        <input
          className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm outline-none"
          value={model.title}
          onChange={(event) => model.onTitleChange(event.target.value)}
        />
      </label>
      <div>
        <label htmlFor={descriptionId} className="mb-1.5 block text-sm text-text-tertiary">
          Description (leave empty to generate)
        </label>
        <Textarea
          id={descriptionId}
          rows={DESCRIPTION_ROWS}
          resize="none"
          value={model.description}
          onChange={(event) => model.onDescriptionChange(event.target.value)}
        />
      </div>
      {model.gitStatus && model.gitStatus.filesChanged > 0 ? (
        <Checkbox
          checked={model.commitAndPush}
          onChange={(event) => model.onCommitAndPushChange(event.target.checked)}
          label={
            <span className="flex w-full items-center justify-between gap-3">
              <span>Commit and push local changes</span>
              <span className="text-xs">
                <span className="text-success">+{model.gitStatus.additions}</span>{' '}
                <span className="text-error">-{model.gitStatus.deletions}</span>
              </span>
            </span>
          }
        />
      ) : null}
      {model.error ? (
        <p role="alert" className="text-sm text-error">
          {model.error}
        </p>
      ) : null}
    </div>
  )
}

function ChangeRequestActions({
  terminology,
  running,
  branchMissing,
  onCreate,
  browserUrl,
  onOpenBrowser,
}: {
  readonly terminology: ReturnType<typeof getChangeRequestTerminology>
  readonly running: boolean
  readonly branchMissing: boolean
  readonly onCreate: (draft: boolean) => void
  readonly browserUrl: string | null
  readonly onOpenBrowser: () => void
}) {
  return (
    <footer className="space-y-1 border-t border-border p-2">
      <Button
        variant="ghost"
        className="w-full justify-start"
        disabled={running || branchMissing}
        onClick={() => onCreate(true)}
      >
        <GitPullRequest className="size-4" />
        Create draft {terminology.shortLabel}
      </Button>
      <Button
        variant="subtle"
        className="w-full justify-start"
        disabled={running || branchMissing}
        onClick={() => onCreate(false)}
      >
        <GitPullRequest className="size-4" />
        Create {terminology.shortLabel}
      </Button>
      <Button
        variant="ghost"
        className="w-full justify-start"
        disabled={!browserUrl || running}
        onClick={onOpenBrowser}
      >
        <ExternalLink className="size-4" />
        Open {terminology.shortLabel} in browser
      </Button>
    </footer>
  )
}

function useChangeRequestComposer(
  props: ChangeRequestComposerProps,
  terminology: ReturnType<typeof getChangeRequestTerminology>,
) {
  const [title, setTitle] = useState(props.session.title)
  const [description, setDescription] = useState('')
  const [commitAndPush, setCommitAndPush] = useState((props.gitStatus?.filesChanged ?? 0) > 0)
  const [createFeatureBranch] = useState(props.vcsStatus?.isDefaultRef === true)
  const [branchName, setBranchName] = useState(() =>
    sanitizeFeatureBranchName(`codex/${props.session.title}`),
  )
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)
  const showToast = useUIStore((state) => state.showToast)
  const queryClient = useQueryClient()

  async function create(draft: boolean) {
    if (running || (createFeatureBranch && branchName.trim().length === 0)) return
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
        void api.openExternal(result.changeRequest.url)
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
    setTitle,
    description,
    setDescription,
    commitAndPush,
    setCommitAndPush,
    createFeatureBranch,
    branchName,
    setBranchName,
    running,
    error,
    fallbackUrl,
    create,
  }
}

function resolveBrowserUrl(fallbackUrl: string | null, vcsStatus: VcsStatus | null) {
  return fallbackUrl ?? vcsStatus?.changeRequest?.url ?? null
}

export function ChangeRequestComposer(props: ChangeRequestComposerProps) {
  const terminology = getChangeRequestTerminology(props.vcsStatus?.sourceControlProvider?.id)
  const composer = useChangeRequestComposer(props, terminology)
  const browserUrl = resolveBrowserUrl(composer.fallbackUrl, props.vcsStatus)

  return (
    <ModalDialog label={`Create ${terminology.singular}`} onClose={props.onClose}>
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
          onBranchNameChange: composer.setBranchName,
          onTitleChange: composer.setTitle,
          onDescriptionChange: composer.setDescription,
          onCommitAndPushChange: composer.setCommitAndPush,
        }}
      />
      <ChangeRequestActions
        terminology={terminology}
        running={composer.running}
        branchMissing={composer.createFeatureBranch && composer.branchName.trim().length === 0}
        onCreate={(draft) => void composer.create(draft)}
        browserUrl={browserUrl}
        onOpenBrowser={() => {
          if (browserUrl) void api.openExternal(browserUrl)
        }}
      />
    </ModalDialog>
  )
}
