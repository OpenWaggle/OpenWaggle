import type { GitStackedAction, VcsStatus } from '@shared/types/git'
import { GitQuickActionButton } from '@/features/git'
import { Button } from '@/shared/ui/Button'

interface DiffBottomBarProps {
  onRevertAll: () => void
  onStageAll: () => void
  canRevertAll: boolean
  canStageAll: boolean
  isActionRunning: boolean
  quickAction?: {
    status: VcsStatus | null
    isBusy: boolean
    onRunAction: (action: GitStackedAction) => void
    onPull: () => void
    onOpenChangeRequest: () => void
    onPublish: () => void
  }
}

export function DiffBottomBar({
  onRevertAll,
  onStageAll,
  canRevertAll,
  canStageAll,
  isActionRunning,
  quickAction,
}: DiffBottomBarProps) {
  return (
    <div className="flex items-center justify-between gap-2 h-10 px-4 bg-diff-header-bg border-t border-border shrink-0">
      <div className="flex items-center gap-2">
        {quickAction ? (
          <GitQuickActionButton
            status={quickAction.status}
            isBusy={quickAction.isBusy}
            onRunAction={quickAction.onRunAction}
            onPull={quickAction.onPull}
            onOpenChangeRequest={quickAction.onOpenChangeRequest}
            onPublish={quickAction.onPublish}
          />
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="unstyled"
          type="button"
          onClick={onRevertAll}
          disabled={!canRevertAll || isActionRunning}
          className="flex h-6.5 items-center gap-1 rounded-md border border-button-border px-3 text-xs text-text-secondary transition-opacity hover:bg-bg-hover disabled:opacity-40"
        >
          Revert all
        </Button>
        <Button
          variant="unstyled"
          type="button"
          onClick={onStageAll}
          disabled={!canStageAll || isActionRunning}
          className="flex h-6.5 items-center gap-1 rounded-md border border-accent bg-diff-stage-bg px-3 text-xs transition-opacity disabled:opacity-40"
        >
          <span className="text-sm font-semibold text-accent">+</span>
          <span className="font-medium text-accent">Stage all</span>
        </Button>
      </div>
    </div>
  )
}
