import type {
  ActionCatalog,
  ActionCatalogEdit,
  ActionDefinition,
  EffectiveDefinition,
} from '@shared/types/action-definitions'
import { Button } from '@/shared/ui/Button'
import { StructuredPayload } from '@/shared/ui/StructuredPayload'
import { actionInvocationLabel, actionSourceLabels } from '../lib/native-action-display'
import { ProjectActionGlyph } from './ProjectActionGlyph'

export function NativeActionSettingsRow({
  entry,
  busy,
  onEdit,
  unavailable,
  apply,
}: {
  readonly entry: EffectiveDefinition<ActionDefinition>
  readonly busy: boolean
  readonly unavailable?: string
  readonly onEdit: () => void
  readonly apply: (edit: ActionCatalogEdit) => Promise<void>
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-4 last:border-0">
      <div className="flex size-9 items-center justify-center rounded-lg bg-bg-hover text-text-secondary">
        <ProjectActionGlyph icon={entry.definition.icon} className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-sm font-medium text-text-primary">{entry.definition.name}</h3>
          <span className="text-xs text-text-tertiary">{actionSourceLabels[entry.source]}</span>
        </div>
        <p className="mt-1 truncate font-mono text-xs text-text-tertiary">
          {actionInvocationLabel(entry.definition.invocation)}
        </p>
      </div>
      {unavailable ? <p className="w-full text-xs text-error-text">{unavailable}</p> : null}
      <Button variant="secondary" onClick={() => onEdit()}>
        Edit
      </Button>
      <details className="w-full pl-12">
        <summary className="cursor-pointer text-xs text-text-tertiary">Storage and removal</summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {entry.source === 'override' ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void apply({
                  type: 'delete-action',
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
                type: 'move-definition',
                collection: 'actions',
                id: entry.definition.id,
                storage: entry.source === 'local' ? 'project' : 'local',
              })
            }
          >
            {entry.source === 'local' ? 'Move to project' : 'Move to local storage'}
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={() =>
              void apply({
                type: 'delete-action',
                id: entry.definition.id,
                storage: entry.source === 'project' ? 'project' : 'local',
              })
            }
          >
            Remove definition
          </Button>
        </div>
      </details>
    </div>
  )
}
export function ActionPublicationRecovery({
  pending,
  busy,
  onDiscard,
}: {
  readonly pending: NonNullable<ActionCatalog['pendingPublication']>
  readonly busy: boolean
  readonly onDiscard: () => void
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <p className="text-sm text-text-secondary">
        An interrupted save conflicts with a newer project edit. Your original definitions and both
        drafts were retained.
      </p>
      <details>
        <summary className="cursor-pointer text-xs text-accent">Inspect pending drafts</summary>
        <StructuredPayload value={pending} className="mt-2 max-h-60 overflow-auto text-xs" />
      </details>
      <Button variant="secondary" disabled={busy} onClick={onDiscard}>
        Keep current definitions and discard pending save
      </Button>
    </div>
  )
}
