import { Button } from '@/shared/ui/Button'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { TextInput } from '@/shared/ui/TextInput'
import type { WorkspaceMutationAction } from '../lib/workspace-file-layout'

export function WorkspaceMutationDialog({
  state,
  actions,
}: {
  readonly state: {
    readonly action: WorkspaceMutationAction | null
    readonly path: string
    readonly relativePath: string
  }
  readonly actions: {
    readonly onPathChange: (path: string) => void
    readonly onApply: () => void
    readonly onClose: () => void
  }
}) {
  if (!state.action) return null
  const isTrash = state.action === 'trash'
  return (
    <ModalDialog label="Workspace file operation" onClose={actions.onClose}>
      <div className="p-5">
        <h2 className="text-sm font-semibold text-text-primary">
          {isTrash ? 'Move file to Trash?' : 'Workspace path'}
        </h2>
        {isTrash ? (
          <p className="mt-2 text-xs leading-5 text-text-secondary">
            {state.relativePath} will be moved to the operating system Trash and can be recovered
            there.
          </p>
        ) : (
          <TextInput
            className="mt-3 w-full font-mono"
            aria-label="Workspace relative path"
            value={state.path}
            onChange={(event) => actions.onPathChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') actions.onApply()
            }}
          />
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={actions.onClose}>
            Cancel
          </Button>
          <Button
            variant={isTrash ? 'danger' : 'accent'}
            size="sm"
            disabled={!isTrash && state.path.trim().length === 0}
            onClick={actions.onApply}
          >
            {isTrash ? 'Move to Trash' : 'Apply'}
          </Button>
        </div>
      </div>
    </ModalDialog>
  )
}

export function GoToLineDialog({
  open,
  value,
  onValueChange,
  onApply,
  onClose,
}: {
  readonly open: boolean
  readonly value: string
  readonly onValueChange: (value: string) => void
  readonly onApply: () => void
  readonly onClose: () => void
}) {
  if (!open) return null
  return (
    <ModalDialog label="Go to line" onClose={onClose}>
      <div className="p-5">
        <h2 className="text-sm font-semibold text-text-primary">Go to line</h2>
        <TextInput
          autoFocus
          className="mt-3 w-full font-mono"
          inputMode="numeric"
          aria-label="Line number"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onApply()
          }}
        />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="accent" size="sm" onClick={onApply}>
            Go
          </Button>
        </div>
      </div>
    </ModalDialog>
  )
}
