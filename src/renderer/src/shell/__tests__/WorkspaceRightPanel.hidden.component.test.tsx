import { render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalStore } from '@/features/terminal'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import type { RightSidebarLayout } from '@/shared/ui/RightSidebarLayout'
import { WorkspaceRightPanel } from '../WorkspaceRightPanel'
import { useWorkspacePanelStore } from '../workspace-panel-store'

vi.mock('@/shared/lib/ipc', () => ({ api: {} }))
vi.mock('@/features/chat/hooks', () => ({ useChat: () => ({ activeSession: null }) }))
vi.mock('@/features/sessions/hooks', () => ({ useProject: () => ({ projectPath: '/repo' }) }))
vi.mock('../useBrowserPreviewOwnerRegistration', () => ({
  useBrowserPreviewOwnerRegistration: vi.fn(),
}))
vi.mock('../WorkspacePanelContent', () => ({ WorkspacePanelContent: () => null }))
vi.mock('../WorkspaceSurfaceTabs', () => ({ WorkspaceSurfaceTabs: () => null }))
vi.mock('@/shared/ui/RightSidebarLayout', () => ({
  RightSidebarLayout: ({ open, children }: ComponentProps<typeof RightSidebarLayout>) => (
    <div data-testid="layout" data-open={String(open)}>
      {children}
    </div>
  ),
}))

const OWNER = 'draft:/repo'

describe('WorkspaceRightPanel on Settings pages', () => {
  beforeEach(() => {
    useWorkspacePanelStore.setState({ groups: {} })
    useTerminalStore.setState({ groups: {} })
    useRightSidebarCoordinator.setState({ activeClaim: null })
    useWorkspacePanelStore.getState().showIndexSurface(OWNER, 'all-panels')
  })

  it('hides the open panel without closing it, so it returns with the Session', () => {
    const { rerender } = render(<WorkspaceRightPanel hidden>Settings</WorkspaceRightPanel>)
    expect(screen.getByTestId('layout')).toHaveAttribute('data-open', 'false')
    expect(useWorkspacePanelStore.getState().groups[OWNER]?.panelOpen).toBe(true)

    rerender(<WorkspaceRightPanel>Chat</WorkspaceRightPanel>)
    expect(screen.getByTestId('layout')).toHaveAttribute('data-open', 'true')
  })
})
