import { ToastOverlay } from '@/components/app/ToastOverlay'
import { FeedbackModal } from '@/components/feedback/FeedbackModal'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { useAutoUpdater } from '@/hooks/useAutoUpdater'
import { useBackgroundRunMonitor } from '@/hooks/useBackgroundRunMonitor'
import { useUIStore } from '@/stores/ui-store'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'
import { WorkspaceMainContent } from './WorkspaceMainContent'
import { WorkspaceTerminal } from './WorkspaceTerminal'

export function WorkspaceShell(): React.JSX.Element {
  useWorkspaceLifecycle()
  useBackgroundRunMonitor()
  useAutoUpdater()
  const feedbackModalOpen = useUIStore((s) => s.feedbackModalOpen)

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg">
      <Sidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <WorkspaceMainContent />
        <WorkspaceTerminal />
      </div>

      <ToastOverlay />
      {feedbackModalOpen && <FeedbackModal />}
    </div>
  )
}
