import { DiffPanel } from '@/components/diff-panel/DiffPanel'
import { ResizeHandle } from '@/components/diff-panel/ResizeHandle'
import { PanelErrorBoundary } from '@/components/shared/PanelErrorBoundary'
import { CHAT_MIN_WIDTH, useUIStore } from '@/stores/ui-store'
import type { ChatDiffSectionState } from './use-chat-panel-controller'

interface ChatDiffPaneProps {
  readonly section: ChatDiffSectionState
}

export function ChatDiffPane({ section }: ChatDiffPaneProps) {
  const diffPanelWidth = useUIStore((s) => s.diffPanelWidth)
  const diffRefreshKey = useUIStore((s) => s.diffRefreshKey)
  const resizeDiffPanel = useUIStore((s) => s.resizeDiffPanel)

  return (
    <>
      <ResizeHandle onResize={resizeDiffPanel} onResizeEnd={() => {}} />
      <div
        className="shrink-0 overflow-hidden animate-in fade-in slide-in-from-right-2 duration-200"
        style={{
          width: `min(${String(diffPanelWidth)}px, max(0px, calc(100% - ${String(CHAT_MIN_WIDTH)}px)))`,
        }}
      >
        <PanelErrorBoundary name="Diff">
          <DiffPanel
            key={diffRefreshKey}
            projectPath={section.projectPath}
            onSendMessage={(content) => {
              void section.onSendMessage(content)
            }}
          />
        </PanelErrorBoundary>
      </div>
    </>
  )
}
