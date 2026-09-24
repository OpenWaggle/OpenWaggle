import type { ActionManagementScope } from '@shared/types/action-management'
import { Button } from '@/shared/ui/Button'
import { useNativeActions } from '../hooks/useNativeActions'

export function ActionDraftRecovery(props: {
  readonly scope: ActionManagementScope
  readonly error: string
  readonly onReload: (revision: string) => void
}) {
  const catalog = useNativeActions(props.scope)
  return (
    <div className="space-y-2 border-t border-border px-5 py-3">
      <p role="alert" className="text-xs text-error-text">
        {props.error}
      </p>
      <Button
        variant="ghost"
        onClick={() => {
          void catalog.refetch().then((result) => {
            if (result.data) props.onReload(result.data.revision)
          })
        }}
      >
        Reload catalog and keep my draft
      </Button>
    </div>
  )
}
