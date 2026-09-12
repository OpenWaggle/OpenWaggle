import { act, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBrowserPreviewFloatingStore } from '@/features/browser-preview'
import { useSessionSummaryUIStore } from '@/features/session-summary'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { useSessionFloatingPreviewStatus } from '../useSessionFloatingPreviewStatus'
import { WorkspaceBrowserFloatingPreview } from '../WorkspaceBrowserFloatingPreview'
import { useWorkspacePanelStore } from '../workspace-panel-store'

vi.mock('@/features/chat/hooks', () => ({
  useChat: () => ({
    activeSession: { id: 'session-1', environmentMode: 'local', projectPath: '/repo' },
  }),
}))
vi.mock('@/features/sessions/hooks', () => ({ useProject: () => ({ projectPath: '/repo' }) }))
vi.mock('@/features/browser-preview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/browser-preview')>()),
  BrowserPreviewFloatingPanel: ({ suspended }: { readonly suspended: boolean }) => (
    <div data-testid="floating-preview" data-suspended={suspended} />
  ),
}))

function openFloating(ownerKey = 'session-1') {
  const store = useWorkspacePanelStore.getState()
  const { previewId } = store.openBrowser(ownerKey, 'https://example.com')
  store.hidePanel(ownerKey)
  useBrowserPreviewFloatingStore.getState().open(ownerKey, previewId)
  return previewId
}

describe('Session Summary and native floating preview coexistence', () => {
  beforeEach(() => {
    localStorage.clear()
    useWorkspacePanelStore.setState({ groups: {} })
    useBrowserPreviewFloatingStore.setState({ byOwnerKey: {} })
    useSessionSummaryUIStore.setState({ panels: {} })
    useRightSidebarCoordinator.setState({ activeClaim: null })
  })

  it('reserves automatic overlay space only for the active Session materialized floating preview', () => {
    const view = renderHook(({ sessionId }) => useSessionFloatingPreviewStatus(sessionId), {
      initialProps: { sessionId: 'session-1' },
    })
    act(() => {
      openFloating('session-2')
    })
    expect(view.result.current).toBe(false)
    let previewId = ''
    act(() => {
      previewId = openFloating()
    })
    expect(view.result.current).toBe(true)
    act(() => useWorkspacePanelStore.getState().showBrowser('session-1', previewId))
    expect(view.result.current).toBe(false)
    view.rerender({ sessionId: 'session-2' })
    expect(view.result.current).toBe(true)
  })

  it('suspends and restores the retained floating preview for manual Summary without affecting another owner', () => {
    const previewId = openFloating()
    const summary = useSessionSummaryUIStore.getState()
    summary.syncPanel('session-1', { available: true, autoHidden: true, rightSidebarOpen: false })
    summary.syncPanel('session-2', { available: true, autoHidden: false, rightSidebarOpen: false })
    render(<WorkspaceBrowserFloatingPreview />)
    const preview = screen.getByTestId('floating-preview')
    expect(preview).toHaveAttribute('data-suspended', 'false')
    act(() => summary.togglePanel('session-1'))
    expect(preview).toHaveAttribute('data-suspended', 'true')
    act(() => summary.dismissTransientPanel('session-1'))
    expect(preview).toHaveAttribute('data-suspended', 'false')
    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey['session-1']?.previewId).toBe(
      previewId,
    )
    expect(useWorkspacePanelStore.getState().groups['session-1']?.browserTabs).toHaveLength(1)
  })

  it('suspends for the current Session inspector and restores the same tab without affecting another owner', () => {
    const previewId = openFloating()
    const coordinator = useRightSidebarCoordinator.getState()
    render(<WorkspaceBrowserFloatingPreview />)
    const preview = screen.getByTestId('floating-preview')
    act(() => coordinator.claimRoute('resources', 'session-2'))
    expect(preview).toHaveAttribute('data-suspended', 'false')
    act(() => coordinator.claimRoute('resources', 'session-1'))
    expect(preview).toHaveAttribute('data-suspended', 'true')
    act(() => coordinator.releaseRoute('resources', 'session-2'))
    expect(preview).toHaveAttribute('data-suspended', 'true')
    act(() => coordinator.releaseRoute('resources', 'session-1'))
    expect(preview).toHaveAttribute('data-suspended', 'false')
    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey['session-1']?.previewId).toBe(
      previewId,
    )
    expect(useWorkspacePanelStore.getState().groups['session-1']?.browserTabs).toHaveLength(1)
  })
})
