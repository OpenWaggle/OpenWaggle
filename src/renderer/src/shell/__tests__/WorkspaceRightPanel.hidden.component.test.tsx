import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceRightPanel } from '../WorkspaceRightPanel'
import { useWorkspacePanelStore } from '../workspace-panel-store'
import { DRAFT_OWNER, resetWorkspaceShellStores } from './workspace-shell.test-harness'

vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi({
    setCurrentBrowserPreview: async () => undefined,
  }),
}))
// Lazily loaded All panels surface: its own tests cover it, and it needs the router.
vi.mock('../right-panel/AllPanelsSurface', () => ({ AllPanelsSurface: () => <p>All panels</p> }))

describe('WorkspaceRightPanel on Settings pages', () => {
  beforeEach(() => {
    resetWorkspaceShellStores()
    useWorkspacePanelStore.getState().showIndexSurface(DRAFT_OWNER, 'all-panels')
  })
  afterEach(resetWorkspaceShellStores)

  it('hides the open panel without closing it, so it returns with the Session', async () => {
    const { rerender } = render(<WorkspaceRightPanel hidden>Settings</WorkspaceRightPanel>)
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
    expect(useWorkspacePanelStore.getState().groups[DRAFT_OWNER]?.panelOpen).toBe(true)

    rerender(<WorkspaceRightPanel>Chat</WorkspaceRightPanel>)
    expect(await screen.findByText('All panels')).toBeVisible()
    expect(screen.getByRole('complementary')).toContainElement(screen.getByText('All panels'))
  })
})
