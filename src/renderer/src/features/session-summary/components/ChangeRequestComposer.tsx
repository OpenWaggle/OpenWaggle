import type { WorkingPath } from '@shared/types/brand'
import type { GitStatusSummary, VcsStatus } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import type { GitRunStackedActionOptions } from '@shared/types/vcs'
import { sanitizeFeatureBranchName } from '@shared/utils/git-stacked-action'
import { getChangeRequestTerminology } from '@shared/utils/source-control-presentation'
import { ExternalLink, GitPullRequest, X } from 'lucide-react'
import { useId, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { Button } from '@/shared/ui/Button'
import { Checkbox } from '@/shared/ui/Checkbox'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { Textarea } from '@/shared/ui/Textarea'
import { useUIStore } from '@/shell/ui-store'

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

function generatedDescription(session: SessionDetail, status: GitStatusSummary | null) {
  const lines = ['## Summary', '', `- ${session.title}`]
  if (status && status.filesChanged > 0) {
    lines.push('', '## Changes', '', `- ${String(status.filesChanged)} changed files`)
    lines.push(`- +${String(status.additions)} / -${String(status.deletions)}`)
  }
  return lines.join('\n')
}

function actionInput(input: {
  readonly session: SessionDetail
  readonly gitStatus: GitStatusSummary | null
  readonly vcsStatus: VcsStatus | null
  readonly title: string
  readonly description: string
  readonly branchName: string
  readonly commitAndPush: boolean
  readonly createFeatureBranch: boolean
  readonly draft: boolean
}): GitRunStackedActionOptions {
  const title = input.title.trim() || input.session.title
  return {
    action: input.commitAndPush ? 'commit_push_pr' : 'create_pr',
    commitMessage: input.commitAndPush ? title : undefined,
    paths: input.commitAndPush
      ? (input.gitStatus?.changedFiles.map((file) => file.path) ?? [])
      : undefined,
    changeRequestTitle: title,
    changeRequestBody:
      input.description.trim() || generatedDescription(input.session, input.gitStatus),
    draft: input.draft,
    createFeatureBranch: input.createFeatureBranch,
    featureBranchName: input.createFeatureBranch ? input.branchName : undefined,
    baseRef: input.vcsStatus?.defaultRef ?? undefined,
  }
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
}: {
  readonly terminology: ReturnType<typeof getChangeRequestTerminology>
  readonly running: boolean
  readonly branchMissing: boolean
  readonly onCreate: (draft: boolean) => void
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
      <Button variant="ghost" className="w-full justify-start" disabled>
        <ExternalLink className="size-4" />
        Open {terminology.shortLabel} in browser
      </Button>
    </footer>
  )
}

export function ChangeRequestComposer(props: ChangeRequestComposerProps) {
  const terminology = getChangeRequestTerminology(props.vcsStatus?.sourceControlProvider?.id)
  const [title, setTitle] = useState(props.session.title)
  const [description, setDescription] = useState('')
  const [commitAndPush, setCommitAndPush] = useState((props.gitStatus?.filesChanged ?? 0) > 0)
  const [createFeatureBranch] = useState(props.vcsStatus?.isDefaultRef === true)
  const [branchName, setBranchName] = useState(() =>
    sanitizeFeatureBranchName(`codex/${props.session.title}`),
  )
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const showToast = useUIStore((state) => state.showToast)

  async function create(draft: boolean) {
    if (running || (createFeatureBranch && branchName.trim().length === 0)) return
    setRunning(true)
    setError(null)
    try {
      const result = await api.runStackedGitAction(
        props.workingPath,
        actionInput({
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

  return (
    <ModalDialog label={`Create ${terminology.singular}`} onClose={props.onClose}>
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm text-text-tertiary">
            {createFeatureBranch ? 'New branch' : (props.vcsStatus?.refName ?? 'Current ref')} →{' '}
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
          createFeatureBranch,
          branchName,
          title,
          description,
          commitAndPush,
          gitStatus: props.gitStatus,
          error,
          onBranchNameChange: setBranchName,
          onTitleChange: setTitle,
          onDescriptionChange: setDescription,
          onCommitAndPushChange: setCommitAndPush,
        }}
      />
      <ChangeRequestActions
        terminology={terminology}
        running={running}
        branchMissing={createFeatureBranch && branchName.trim().length === 0}
        onCreate={(draft) => void create(draft)}
      />
    </ModalDialog>
  )
}
