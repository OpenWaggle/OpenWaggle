import { formatWorktreePathForDisplay } from '@shared/utils/worktree'
import { RefreshCw, X } from 'lucide-react'
import { DiffPanel } from '@/features/diff-panel/components'
import { Button } from '@/shared/ui/Button'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import { useUIStore } from '@/shell/ui-store'
import type { ChatDiffSectionState } from '../model'

interface ChatDiffPaneProps {
  readonly section: ChatDiffSectionState
  readonly onClose: () => void
}

export function ChatDiffPane({ section, onClose }: ChatDiffPaneProps) {
  // A working path that differs from the opened project is a Session worktree. The two
  // are distinct brands, so compare the underlying strings (equal only in local mode).
  const worktreeLabel =
    section.workingPath !== null && String(section.workingPath) !== String(section.repositoryPath)
      ? formatWorktreePathForDisplay(section.workingPath)
      : null
  const diffRefreshKey = useUIStore((s) => s.diffRefreshKey)
  const bumpDiffRefreshKey = useUIStore((s) => s.bumpDiffRefreshKey)

  return (
    <div className="flex size-full min-w-0 flex-col overflow-hidden bg-diff-bg">
      <header className="drag-region flex h-12 shrink-0 items-center justify-between border-b border-border bg-diff-header-bg px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="no-drag text-[13px] font-medium text-text-primary">Changes</span>
          {/*
            Name the tree, not just the scope. Stage all, Revert all and Commit act on
            whatever this panel is showing, and for a worktree-mode session that is the
            Session worktree rather than the opened checkout — which must not be
            something the user has to infer (ADR 0018).
          */}
          <span className="no-drag truncate text-[11px] text-text-tertiary">
            {worktreeLabel === null ? 'Opened checkout' : `Worktree · ${worktreeLabel}`}
          </span>
        </div>
        <div className="no-drag flex items-center gap-1">
          <Button
            variant="unstyled"
            type="button"
            aria-label="Refresh diff"
            onClick={bumpDiffRefreshKey}
            className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
            title="Refresh diff"
          >
            <RefreshCw className="size-3.5" />
          </Button>
          <Button
            variant="unstyled"
            type="button"
            aria-label="Close diff sidebar"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
            title="Close diff sidebar"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </header>

      <PanelErrorBoundary name="Diff" className="min-h-0 flex-1 overflow-hidden">
        <DiffPanel
          refreshToken={diffRefreshKey}
          workingPath={section.workingPath}
          repositoryPath={section.repositoryPath}
          sessionId={section.sessionId}
          // The promise is returned, not dropped: the review is only cleared once the send worked.
          onSendMessage={(content) => section.onSendMessage(content)}
        />
      </PanelErrorBoundary>
    </div>
  )
}
