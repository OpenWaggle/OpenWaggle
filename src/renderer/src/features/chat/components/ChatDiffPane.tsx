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
  const diffRefreshKey = useUIStore((s) => s.diffRefreshKey)
  const bumpDiffRefreshKey = useUIStore((s) => s.bumpDiffRefreshKey)

  return (
    <div className="flex size-full min-w-0 flex-col overflow-hidden bg-diff-bg">
      <header className="drag-region flex h-12 shrink-0 items-center justify-between border-b border-border bg-diff-header-bg px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="no-drag text-[13px] font-medium text-text-primary">Changes</span>
          <span className="no-drag text-[11px] text-text-tertiary">Working tree diff</span>
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
