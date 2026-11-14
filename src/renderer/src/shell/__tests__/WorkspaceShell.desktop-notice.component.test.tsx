import type { DesktopNativeRecoveryOutcome } from '@shared/types/openwaggle-desktop-api'
import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDesktopNativeAdmissionStore } from '../desktop-native-admission-store'
import { renderWorkspaceShell } from './workspace-shell-render.test-harness'
import { resetWorkspaceShellStores } from './workspace-shell.test-harness'

const mocks = vi.hoisted(() => ({
  getIssue: vi.fn<() => Promise<string | null>>(),
  recover: vi.fn<() => Promise<DesktopNativeRecoveryOutcome>>(),
}))

vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi({
    getDesktopNativeAdmissionIssue: mocks.getIssue,
    recoverDesktopNativeAdmission: mocks.recover,
    listActiveRuns: async () => [],
  }),
}))
// Other features' surfaces, each with its own tests: a marker shows where the header sits.
vi.mock('@/features/sidebar/components', () => ({ Sidebar: () => <aside>Sidebar</aside> }))
vi.mock('../Header', () => ({ Header: () => <header>Header</header> }))
vi.mock('../right-panel/RightPanelHost', () => ({ RightPanelHost: () => null }))
// App data loading and shortcuts, covered by useWorkspaceLifecycle*.component.test.tsx.
vi.mock('../useWorkspaceLifecycle', () => ({ useWorkspaceLifecycle: () => undefined }))
// Lazily loaded: it rendered only when its import resolved before the assertions ran.
vi.mock('../WorkspaceBrowserFloatingPreview', () => ({
  WorkspaceBrowserFloatingPreview: () => null,
}))

function follows(node: Node, other: Node) {
  return Boolean(node.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING)
}

function resetStores() {
  resetWorkspaceShellStores()
  useDesktopNativeAdmissionStore.setState({ loading: 'idle', notice: { kind: 'hidden' } })
}

beforeEach(() => {
  resetStores()
  mocks.getIssue.mockReset().mockResolvedValue('Desktop tools are paused.')
  mocks.recover.mockReset()
})
afterEach(resetStores)

describe('workspace shell desktop tools notice', () => {
  it('sits below the app header in the workspace', async () => {
    await renderWorkspaceShell('/')
    const notice = await screen.findByRole('region', { name: 'Desktop tools status' })
    expect(follows(screen.getByText('Header'), notice)).toBe(true)
    expect(follows(notice, screen.getByText('Route content'))).toBe(true)
  })

  it.each(['/settings', '/settings/actions', '/usage'])(
    'moves below the route at %s, clear of the window controls and the Settings title bar',
    async (pathname) => {
      await renderWorkspaceShell(pathname)
      const notice = await screen.findByRole('region', { name: 'Desktop tools status' })
      expect(screen.queryByText('Header')).not.toBeInTheDocument()
      expect(follows(screen.getByText('Route content'), notice)).toBe(true)
      expect(screen.getAllByRole('region', { name: 'Desktop tools status' })).toHaveLength(1)
    },
  )

  it('keeps an in-flight recovery and its result across a Settings round trip', async () => {
    const result = Promise.withResolvers<DesktopNativeRecoveryOutcome>()
    mocks.recover.mockReturnValue(result.promise)
    const view = await renderWorkspaceShell('/')
    fireEvent.click(await screen.findByRole('button', { name: 'Recover desktop tools' }))
    await view.navigate('/settings')
    expect(screen.getByRole('button', { name: 'Recovering…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await act(async () =>
      result.resolve({ outcome: 'failed', message: 'Still settling.', retryable: true }),
    )
    await view.navigate('/')
    expect(screen.getByRole('alert')).toHaveTextContent('Still settling.')
    // A remounted shell reuses the GUI-lifetime status instead of reading it again.
    view.unmount()
    await renderWorkspaceShell('/')
    expect(screen.getByRole('alert')).toHaveTextContent('Still settling.')
    expect(mocks.getIssue).toHaveBeenCalledOnce()
    expect(mocks.recover).toHaveBeenCalledOnce()
  })
})
