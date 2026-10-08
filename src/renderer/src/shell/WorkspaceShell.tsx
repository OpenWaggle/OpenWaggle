import { useRouterState } from '@tanstack/react-router'
import { lazy, type ReactNode, Suspense, useEffect } from 'react'
import {
  useBackgroundRunMonitor,
  useSetupActionTerminalReconciliation,
} from '@/features/chat/hooks'
import { ActionPanelLayout } from '@/features/project-actions'
import { Sidebar } from '@/features/sidebar/components'
import { useTerminalActivityMonitor } from '@/features/terminal'
import { Header } from '@/shell/Header'
import { ToastOverlay } from '@/shell/ToastOverlay'
import { useUIStore } from '@/shell/ui-store'
import { useAutoUpdater } from '@/shell/useAutoUpdater'
import { DesktopNativeAdmissionNotice } from './DesktopNativeAdmissionNotice'
import { useDesktopNativeAdmissionStore } from './desktop-native-admission-store'
import { RightPanelCommandPalette } from './right-panel/RightPanelCommandPalette'
import { RightPanelHost } from './right-panel/RightPanelHost'
import { RightPanelMaximizePublisher } from './right-panel/RightPanelMaximizePublisher'
import { isRightPanelChatPath } from './right-panel/useRightPanelRouteNavigation'
import { useWorkspaceLifecycle } from './useWorkspaceLifecycle'
import { WorkspaceRightPanel } from './WorkspaceRightPanel'
import { WorkspaceTerminal } from './WorkspaceTerminal'

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
  const loadDesktopNativeAdmission = useDesktopNativeAdmissionStore((state) => state.load)
  useEffect(loadDesktopNativeAdmission, [loadDesktopNativeAdmission])
  const feedbackModalOpen = useUIStore((s) => s.feedbackModalOpen)
  const commandSurface = useUIStore((s) => s.commandSurface)
  const settingsOpen = useRouterState({
    select: (state) => /^\/settings(?:\/|$)/.test(state.location.pathname),
  })
  const chatRoute = useRouterState({
    select: (state) => isRightPanelChatPath(state.location.pathname),
  })

  return (
    <div className="flex size-full overflow-hidden bg-bg">
      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {!settingsOpen && <Header />}
        {!settingsOpen && <DesktopNativeAdmissionNotice placement="top" />}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <ActionPanelLayout>
            <WorkspaceRightPanel hidden={settingsOpen}>
              <div className="relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
                {children}
                <WorkspaceTerminal />
                <Suspense fallback={null}>
                  <LazyWorkspaceBrowserFloatingPreview />
                </Suspense>
              </div>
            </WorkspaceRightPanel>
          </ActionPanelLayout>
          {chatRoute ? <RightPanelHost /> : null}
          <RightPanelMaximizePublisher />
        </div>
        {settingsOpen && <DesktopNativeAdmissionNotice placement="bottom" />}
      </div>

      <ToastOverlay />
      <Suspense fallback={null}>
        {feedbackModalOpen && <LazyFeedbackModal />}
        {commandSurface === 'commands' && <RightPanelCommandPalette chatRoute={chatRoute} />}
        {commandSurface === 'files' && <LazyProjectFilePicker />}
        {commandSurface === 'content' && <LazyProjectContentSearch />}
      </Suspense>
    </div>
  )
}
