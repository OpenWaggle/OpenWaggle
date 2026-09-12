import { lazy, type ReactNode, Suspense } from 'react'
import {
  useBackgroundRunMonitor,
  useSetupActionTerminalReconciliation,
} from '@/features/chat/hooks'
import { Sidebar } from '@/features/sidebar/components'
import { useTerminalActivityMonitor } from '@/features/terminal'
import { Header } from '@/shell/Header'
import { ToastOverlay } from '@/shell/ToastOverlay'
import { useUIStore } from '@/shell/ui-store'
import { useAutoUpdater } from '@/shell/useAutoUpdater'
import { useDesktopNativeAdmissionNotice } from './useDesktopNativeAdmissionNotice'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'
import { WorkspaceRightPanel } from './WorkspaceRightPanel'
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
const LazyWorkspaceBrowserFloatingPreview = lazy(() =>
  import('./WorkspaceBrowserFloatingPreview').then((module) => ({
    default: module.WorkspaceBrowserFloatingPreview,
  })),
)

interface WorkspaceShellProps {
  readonly children: ReactNode
}

export function WorkspaceShell({ children }: WorkspaceShellProps) {
  useWorkspaceLifecycle()
  useBackgroundRunMonitor()
  useTerminalActivityMonitor()
  useSetupActionTerminalReconciliation()
  useAutoUpdater()
  useDesktopNativeAdmissionNotice()
  const feedbackModalOpen = useUIStore((s) => s.feedbackModalOpen)
  const commandSurface = useUIStore((s) => s.commandSurface)

  return (
    <div className="flex size-full overflow-hidden bg-bg">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header />
        <WorkspaceRightPanel>
          <div className="relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
            {children}
            <WorkspaceTerminal />
            <Suspense fallback={null}>
              <LazyWorkspaceBrowserFloatingPreview />
            </Suspense>
          </div>
        </WorkspaceRightPanel>
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
