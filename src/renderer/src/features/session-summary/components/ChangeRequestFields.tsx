import type { GitStatusSummary } from '@shared/types/git'
import { useId } from 'react'
import { Checkbox } from '@/shared/ui/Checkbox'
import { Textarea } from '@/shared/ui/Textarea'

const DESCRIPTION_ROWS = 6

export interface ChangeRequestFieldsModel {
  readonly createFeatureBranch: boolean
  readonly branchName: string
  readonly title: string
  readonly description: string
  readonly commitAndPush: boolean
  readonly gitStatus: GitStatusSummary | null
  readonly error: string | null
  readonly disabled: boolean
  readonly onBranchNameChange: (value: string) => void
  readonly onTitleChange: (value: string) => void
  readonly onDescriptionChange: (value: string) => void
  readonly onCommitAndPushChange: (value: boolean) => void
}

export function ChangeRequestFields({ model }: { readonly model: ChangeRequestFieldsModel }) {
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
            disabled={model.disabled}
            onChange={(event) => model.onBranchNameChange(event.target.value)}
          />
        </label>
      ) : null}
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-text-secondary">Title</span>
        <input
          className="h-9 w-full rounded-md border border-border bg-bg px-3 text-sm outline-none"
          value={model.title}
          disabled={model.disabled}
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
          disabled={model.disabled}
          onChange={(event) => model.onDescriptionChange(event.target.value)}
        />
      </div>
      {model.gitStatus && model.gitStatus.filesChanged > 0 ? (
        <Checkbox
          checked={model.commitAndPush}
          disabled={model.disabled}
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
