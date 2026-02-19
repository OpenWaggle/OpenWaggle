interface DiffBottomBarProps {
  onRevertAll: () => void
  onStageAll: () => void
  hasChanges: boolean
}

export function DiffBottomBar({
  onRevertAll,
  onStageAll,
  hasChanges,
}: DiffBottomBarProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-end gap-2 h-10 px-4 bg-diff-header-bg border-t border-border shrink-0">
      <button
        type="button"
        onClick={onRevertAll}
        disabled={!hasChanges}
        className="flex items-center gap-1 h-[26px] px-3 rounded-[5px] border border-button-border text-[11px] text-text-secondary disabled:opacity-40 transition-opacity hover:bg-bg-hover"
      >
        Revert all
      </button>
      <button
        type="button"
        onClick={onStageAll}
        disabled={!hasChanges}
        className="flex items-center gap-1 h-[26px] px-3 rounded-[5px] bg-diff-stage-bg border border-accent text-[11px] disabled:opacity-40 transition-opacity"
      >
        <span className="text-[13px] font-semibold text-accent">+</span>
        <span className="font-medium text-accent">Stage all</span>
      </button>
    </div>
  )
}
