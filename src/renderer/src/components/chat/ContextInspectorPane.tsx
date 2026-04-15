import { ContextInspector } from '@/components/context-inspector/ContextInspector'
import { ResizeHandle } from '@/components/diff-panel/ResizeHandle'
import { PanelErrorBoundary } from '@/components/shared/PanelErrorBoundary'
import { useUIStore } from '@/stores/ui-store'

const CHAT_MIN_WIDTH = 420

export function ContextInspectorPane() {
  const diffPanelWidth = useUIStore((s) => s.diffPanelWidth)
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
        <PanelErrorBoundary name="Context Inspector">
          <ContextInspector />
        </PanelErrorBoundary>
      </div>
    </>
  )
}
