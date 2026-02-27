import { ChatPanel } from '@/components/chat/ChatPanel'
import { PanelErrorBoundary } from '@/components/shared/PanelErrorBoundary'
import { SkillsPanel } from '@/components/skills/SkillsPanel'
import { useUIStore } from '@/stores/ui-store'

export function WorkspaceMainContent(): React.JSX.Element {
  const activeView = useUIStore((s) => s.activeView)

  return (
    <div className="flex flex-1 overflow-hidden">
      {activeView === 'skills' ? (
        <PanelErrorBoundary name="Skills" className="flex flex-1 overflow-hidden">
          <SkillsPanel />
        </PanelErrorBoundary>
      ) : (
        <PanelErrorBoundary
          name="Chat"
          className="flex min-w-0 flex-1 justify-center overflow-hidden"
        >
          <ChatPanel />
        </PanelErrorBoundary>
      )}
    </div>
  )
}
