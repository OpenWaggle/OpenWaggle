import type {
  ActionCatalog,
  ActionCatalogEdit,
  ActionStorage,
  PreparationDefinition,
} from '@shared/types/action-definitions'
import { Button } from '@/shared/ui/Button'
import { SyntaxBlock } from '@/shared/ui/SyntaxBlock'
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
  readonly onEdit: (draft: { definition: PreparationDefinition; source: ActionStorage }) => void
  readonly onReview: (id: string) => void
  readonly apply: Apply
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">
            {phase === 'setup' ? 'Set up workspace' : 'Clean up workspace'}
          </h3>
          <p className="mt-1 text-xs text-text-tertiary">
            {phase === 'setup'
              ? 'Before the first agent turn in a new worktree.'
              : 'Before actual worktree removal, after sessions release it.'}
          </p>
        </div>
        <Button
          disabled={!profileId}
          onClick={() =>
            onEdit({
              definition: entry?.definition ?? {
                id: crypto.randomUUID(),
                profileId,
                phase,
                invocation: { type: 'command', command: '', directory: '.' },
              },
              source: entry?.source === 'project' ? 'project' : 'local',
            })
          }
        >
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
                ? 'Review required'
                : entry.review === 'enabled'
                  ? 'Enabled on this machine'
                  : 'Disabled on this machine'}
            </span>
            <Button variant="ghost" disabled={busy} onClick={() => onReview(entry.definition.id)}>
              {entry.review === 'enabled' ? 'Review or disable' : 'Review changes'}
            </Button>
          </div>
          <PreparationStorageControls entry={entry} busy={busy} apply={apply} />
        </>
      ) : (
        <p className="text-xs text-text-tertiary">No {phase} configured.</p>
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
