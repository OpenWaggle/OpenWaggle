import { ToastOverlay } from '@/components/app/ToastOverlay'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { useBackgroundRunMonitor } from '@/hooks/useBackgroundRunMonitor'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'
import { WorkspaceMainContent } from './WorkspaceMainContent'
import { WorkspaceTerminal } from './WorkspaceTerminal'

export function WorkspaceShell(): React.JSX.Element {
  useWorkspaceLifecycle()
  useBackgroundRunMonitor()

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg">
      <Sidebar />

      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <WorkspaceMainContent />
        <WorkspaceTerminal />
      </div>

      <ToastOverlay />
    </div>
  )
}
