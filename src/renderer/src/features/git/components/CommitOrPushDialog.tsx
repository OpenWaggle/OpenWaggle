import { X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { ModalDialog } from '@/shared/ui/ModalDialog'
import { CommitOrPushDialogForm } from './CommitOrPushDialogForm'
import type { CommitOrPushDialogProps } from './commit-or-push-dialog-types'
import { useCommitOrPushDialogController } from './use-commit-or-push-dialog-controller'

export type {
  CommitOrPushDialogProps,
  CommitOrPushOperation,
  CommitOrPushRepositoryContext,
} from './commit-or-push-dialog-types'

export function CommitOrPushDialog(props: CommitOrPushDialogProps) {
  const controller = useCommitOrPushDialogController(props)
  const close = () => {
    if (!props.operation.running) props.onClose()
  }
  return (
    <ModalDialog label="Commit or push" onClose={close} dismissible={!props.operation.running}>
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-text-tertiary">{controller.origin}</p>
          <h2 className="text-sm font-semibold text-text-primary">Commit or push</h2>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close commit or push"
          aria-disabled={props.operation.running}
          onClick={close}
        >
          <X className="size-4" />
        </Button>
      </header>
      <CommitOrPushDialogForm controller={controller} operation={props.operation} />
    </ModalDialog>
  )
}
