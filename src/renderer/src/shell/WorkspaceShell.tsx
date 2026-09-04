import { lazy, type ReactNode, Suspense } from 'react'
import { useBackgroundRunMonitor } from '@/features/chat/hooks'
import { Sidebar } from '@/features/sidebar/components'
import { Header } from '@/shell/Header'
import { ToastOverlay } from '@/shell/ToastOverlay'
import { useUIStore } from '@/shell/ui-store'
import { useAutoUpdater } from '@/shell/useAutoUpdater'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'
import { WorkspaceTerminal } from './WorkspaceTerminal'

const LazyGlobalCommandPalette = lazy(() =>
  import('@/features/command-palette/components/GlobalCommandPalette').then((module) => ({
    default: module.GlobalCommandPalette,
  })),
)
const LazyFeedbackModal = lazy(() =>
  import('@/features/feedback/components/FeedbackModal').then((module) => ({
    default: module.FeedbackModal,
  })),
)
const LazyProjectContentSearch = lazy(() =>
  import('@/features/workspace-files/components/ProjectContentSearch').then((module) => ({
    default: module.ProjectContentSearch,
  })),
)
const LazyProjectFilePicker = lazy(() =>
  import('@/features/workspace-files/components/ProjectFilePicker').then((module) => ({
    default: module.ProjectFilePicker,
  })),
)

interface WorkspaceShellProps {
  readonly children: ReactNode
}

export function WorkspaceShell({ children }: WorkspaceShellProps) {
  useWorkspaceLifecycle()
  useBackgroundRunMonitor()
  useAutoUpdater()
  const feedbackModalOpen = useUIStore((s) => s.feedbackModalOpen)
  const commandSurface = useUIStore((s) => s.commandSurface)

  return (
    <div className="flex size-full overflow-hidden bg-bg">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header />
        {children}
        <WorkspaceTerminal />
      </div>

      <ToastOverlay />
      <Suspense fallback={null}>
        {feedbackModalOpen && <LazyFeedbackModal />}
        {commandSurface === 'commands' && <LazyGlobalCommandPalette />}
        {commandSurface === 'files' && <LazyProjectFilePicker />}
        {commandSurface === 'content' && <LazyProjectContentSearch />}
      </Suspense>
    </div>
  )
}
