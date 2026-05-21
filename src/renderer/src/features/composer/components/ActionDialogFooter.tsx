import { Button } from '@/shared/ui/Button'
import type { ActionDialogConfig } from '../lib/action-dialog-config'

interface ActionDialogFooterProps {
  readonly config: ActionDialogConfig
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

export function ActionDialogFooter({ config, busy, onCancel, onConfirm }: ActionDialogFooterProps) {
  return (
    <div className="mt-4 flex items-center justify-end gap-2">
      <Button variant="secondary" onClick={onCancel} disabled={busy} className="h-8">
        Cancel
      </Button>
      <Button
        variant={config.confirmTone === 'danger' ? 'danger' : 'accent'}
        onClick={() => {
          void onConfirm()
        }}
        disabled={busy}
        className="h-8"
      >
        {busy ? 'Working...' : config.confirmLabel}
      </Button>
    </div>
  )
}
