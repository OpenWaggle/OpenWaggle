import { ChatPanel } from '@/components/chat/ChatPanel'
import { McpPanel } from '@/components/mcp/McpPanel'
import { PanelErrorBoundary } from '@/components/shared/PanelErrorBoundary'
import { SkillsPanel } from '@/components/skills/SkillsPanel'
import { useUIStore } from '@/stores/ui-store'

export function WorkspaceMainContent() {
  const activeView = useUIStore((s) => s.activeView)

  if (activeView === 'skills') {
    return (
      <div className="flex flex-1 overflow-hidden">
        <PanelErrorBoundary name="Skills" className="flex flex-1 overflow-hidden">
          <SkillsPanel />
        </PanelErrorBoundary>
      </div>
    )
  }

  if (activeView === 'mcps') {
    return (
      <div className="flex flex-1 overflow-hidden">
        <PanelErrorBoundary name="MCPs" className="flex flex-1 overflow-hidden">
          <McpPanel />
        </PanelErrorBoundary>
      </div>
    )
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <PanelErrorBoundary
        name="Chat"
        className="flex min-w-0 flex-1 justify-center overflow-hidden"
      >
        <ChatPanel />
      </PanelErrorBoundary>
    </div>
  )
}
