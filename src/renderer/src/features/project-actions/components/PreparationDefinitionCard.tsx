import type { ActionCatalog, ActionCatalogEdit } from '@shared/types/action-definitions'
import { Button } from '@/shared/ui/Button'
import { SyntaxBlock } from '@/shared/ui/SyntaxBlock'
import { PREPARATION_COPY } from '../lib/action-panel-copy'
import { actionInvocationLabel, actionSourceLabels } from '../lib/native-action-display'

type Entry = ActionCatalog['preparation'][number]
type Apply = (edit: ActionCatalogEdit) => Promise<unknown>
export function PreparationDefinitionCard({
  data: { entry, phase, profileId },
  busy,
  onEdit,
  onReview,
  apply,
}: {
  readonly data: {
    readonly entry: Entry | undefined
    readonly phase: 'setup' | 'cleanup'
    readonly profileId: string
  }
  readonly busy: boolean
  readonly onEdit: () => void
  readonly onReview: (id: string) => void
  readonly apply: Apply
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{PREPARATION_COPY[phase].title}</h3>
          <p className="mt-1 text-xs leading-5 text-text-tertiary">
            {PREPARATION_COPY[phase].description}
          </p>
        </div>
        <Button disabled={!profileId} onClick={onEdit}>
          {entry ? 'Edit' : 'Configure'}
        </Button>
      </div>
      {entry ? (
        <>
          <SyntaxBlock
            source={actionInvocationLabel(entry.definition.invocation)}
            language="shellscript"
            wrap
          />
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-text-tertiary">{actionSourceLabels[entry.source]}</span>
            <span
              className={
                entry.review === 'required'
                  ? 'text-xs font-medium text-warning'
                  : 'text-xs text-text-tertiary'
              }
            >
              {entry.review === 'required'
                ? 'Check it before it runs'
                : entry.review === 'enabled'
                  ? 'On for you'
                  : 'Off for you'}
            </span>
            <Button variant="ghost" disabled={busy} onClick={() => onReview(entry.definition.id)}>
              {entry.review === 'required' ? 'Check it' : 'Turn on or off'}
            </Button>
          </div>
          <PreparationStorageControls entry={entry} busy={busy} apply={apply} />
        </>
      ) : (
        <p className="text-xs text-text-tertiary">Nothing set up yet.</p>
      )}
    </div>
  )
}
function PreparationStorageControls({
  entry,
  busy,
  apply,
}: {
  readonly entry: Entry
  readonly busy: boolean
  readonly apply: Apply
}) {
  return (
    <details>
      <summary className="cursor-pointer text-xs text-text-tertiary">Storage and removal</summary>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          disabled={busy}
          onClick={() =>
            void apply({
              type: 'move-definition',
              collection: 'preparation',
              id: entry.definition.id,
              storage: entry.source === 'project' ? 'local' : 'project',
            })
          }
        >
          {entry.source === 'project' ? 'Move to local storage' : 'Store in project'}
        </Button>
        {entry.source === 'override' ? (
          <Button
            disabled={busy}
            onClick={() =>
              void apply({
                type: 'delete-preparation',
                id: entry.definition.id,
                storage: 'local',
              })
            }
          >
            Restore shared version
          </Button>
        ) : null}
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void apply({
              type: 'delete-preparation',
              id: entry.definition.id,
              storage: entry.source === 'project' ? 'project' : 'local',
            })
          }
        >
          Remove definition
        </Button>
      </div>
    </details>
  )
}
