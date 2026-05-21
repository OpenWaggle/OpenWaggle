import { useActionDialogController } from '../hooks/useActionDialogController'
import { ActionDialogError } from './ActionDialogError'
import { ActionDialogFooter } from './ActionDialogFooter'
import { ActionDialogInput } from './ActionDialogInput'

interface ActionDialogProps {
  readonly onToast?: (message: string) => void
}

export function ActionDialog({ onToast }: ActionDialogProps) {
  const dialog = useActionDialogController({ onToast })
  if (!dialog.actionDialog || !dialog.config) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-4">
      <div className="w-full max-w-[360px] rounded-xl border border-border-light bg-bg-secondary p-4 shadow-2xl">
        <h3 className="text-sm font-semibold text-text-primary">{dialog.config.title}</h3>
        <p className="mt-1 text-[12px] text-text-tertiary">{dialog.config.description}</p>
        <ActionDialogInput
          inputRef={dialog.inputRef}
          value={dialog.actionDialogInput}
          placeholder={dialog.config.inputPlaceholder}
          onValueChange={dialog.setActionDialogInput}
          onConfirm={dialog.handleConfirm}
        />
        <ActionDialogError message={dialog.actionDialogError} />
        <ActionDialogFooter
          config={dialog.config}
          busy={dialog.actionDialogBusy}
          onCancel={dialog.closeActionDialog}
          onConfirm={dialog.handleConfirm}
        />
      </div>
    </div>
  )
}
