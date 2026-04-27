import { RefreshCw, X } from 'lucide-react'
import { DiffPanel } from '@/components/diff-panel/DiffPanel'
import { PanelErrorBoundary } from '@/components/shared/PanelErrorBoundary'
import { useUIStore } from '@/stores/ui-store'
import type { ChatDiffSectionState } from './use-chat-panel-controller'

interface ChatDiffPaneProps {
  readonly section: ChatDiffSectionState
  readonly onClose: () => void
}

export function ChatDiffPane({ section, onClose }: ChatDiffPaneProps) {
  const diffRefreshKey = useUIStore((s) => s.diffRefreshKey)
  const bumpDiffRefreshKey = useUIStore((s) => s.bumpDiffRefreshKey)

  return (
    <div className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-diff-bg">
      <header className="drag-region flex h-12 shrink-0 items-center justify-between border-b border-border bg-diff-header-bg px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="no-drag text-[13px] font-medium text-text-primary">Changes</span>
          <span className="no-drag text-[11px] text-text-tertiary">Working tree diff</span>
        </div>
        <div className="no-drag flex items-center gap-1">
          <button
            type="button"
            aria-label="Refresh diff"
            onClick={bumpDiffRefreshKey}
            className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
            title="Refresh diff"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Close diff sidebar"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-bg-hover hover:text-text-secondary"
            title="Close diff sidebar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <PanelErrorBoundary name="Diff" className="min-h-0 flex-1 overflow-hidden">
        <DiffPanel
          key={diffRefreshKey}
          projectPath={section.projectPath}
          onSendMessage={(content) => {
            void section.onSendMessage(content)
          }}
        />
      </PanelErrorBoundary>
    </div>
  )
}
