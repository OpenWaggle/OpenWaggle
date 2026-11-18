import { AlertTriangle, RotateCcw, Trash2, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import type { PanelShortcutRow } from '../../lib/panel-shortcut-model'

export function BlockingConflictNotice({ labels }: { readonly labels: readonly string[] }) {
  if (labels.length === 0) return null
  return (
    <p role="alert" className="flex items-start gap-1.5 text-xs text-error-text">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>
        Already used by {labels.map((label) => `“${label}”`).join(', ')}. Panel shortcuts must be
        unique; choose another combination.
      </span>
    </p>
  )
}

export interface PanelShortcutRowCommands {
  readonly saving: boolean
  readonly save: (row: PanelShortcutRow, binding: null) => Promise<void>
  readonly reset: (row: PanelShortcutRow) => Promise<void>
}

export function PanelShortcutActions(props: {
  readonly row: PanelShortcutRow
  readonly context: PanelShortcutRowCommands
  readonly dirty: boolean
  readonly canSave: boolean
  readonly onDiscard: () => void
  readonly onSave: () => void
}) {
  const { row, context } = props
  const clearable = row.kind === 'command' ? row.clearable : row.binding !== null
  const resettable = row.kind === 'command' && row.custom && !row.clearable
  return (
    <>
      {props.dirty ? (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Discard changes"
            aria-label={`Discard changes to ${row.label}`}
            onClick={props.onDiscard}
          >
            <X className="size-3" />
          </Button>
          <Button variant="accent" size="xs" disabled={!props.canSave} onClick={props.onSave}>
            Save
          </Button>
        </>
      ) : null}
      {resettable ? (
        <Button
          variant="ghost"
          size="icon-sm"
          title="Reset binding"
          aria-label={`Reset ${row.label}`}
          disabled={context.saving}
          onClick={() => void context.reset(row)}
        >
          <RotateCcw className="size-3" />
        </Button>
      ) : null}
      {clearable && !props.dirty ? (
        <Button
          variant="ghost"
          size="icon-sm"
          title={
            row.kind === 'extension-panel' && !row.installed ? 'Forget binding' : 'Clear binding'
          }
          aria-label={`Clear binding for ${row.label}`}
          disabled={context.saving}
          onClick={() => void context.save(row, null)}
        >
          <Trash2 className="size-3" />
        </Button>
      ) : null}
    </>
  )
}
