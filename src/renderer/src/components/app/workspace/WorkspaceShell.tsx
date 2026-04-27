import type { ReactNode } from 'react'
import { ToastOverlay } from '@/components/app/ToastOverlay'
import { FeedbackModal } from '@/components/feedback/FeedbackModal'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/layout/Sidebar'
import { useAutoUpdater } from '@/hooks/useAutoUpdater'
import { useBackgroundRunMonitor } from '@/hooks/useBackgroundRunMonitor'
import { useUIStore } from '@/stores/ui-store'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'
import { WorkspaceTerminal } from './WorkspaceTerminal'

interface WorkspaceShellProps {
  readonly children: ReactNode
}

export function WorkspaceShell({ children }: WorkspaceShellProps) {
  useWorkspaceLifecycle()
  useBackgroundRunMonitor()
  useAutoUpdater()
  const feedbackModalOpen = useUIStore((s) => s.feedbackModalOpen)

  return (
    <div className="flex h-full w-full overflow-hidden bg-bg">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header />
        {children}
        <WorkspaceTerminal />
      </div>

      <ToastOverlay />
      {feedbackModalOpen && <FeedbackModal />}
    </div>
  )
}
