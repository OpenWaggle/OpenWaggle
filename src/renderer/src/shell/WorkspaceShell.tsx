import type { ReactNode } from 'react'
import { useBackgroundRunMonitor } from '@/features/chat/hooks'
import { FeedbackModal } from '@/features/feedback/components'
import { Sidebar } from '@/features/sidebar/components'
import { Header } from '@/shell/Header'
import { ToastOverlay } from '@/shell/ToastOverlay'
import { useUIStore } from '@/shell/ui-store'
import { useAutoUpdater } from '@/shell/useAutoUpdater'
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
    <div className="flex size-full overflow-hidden bg-bg">
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
