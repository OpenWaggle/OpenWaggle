import type { DesktopNativeRecoveryOutcome } from '@shared/types/openwaggle-desktop-api'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDesktopNativeAdmissionStore } from '../desktop-native-admission-store'
import { WorkspaceShell } from '../WorkspaceShell'

type LocationSelection = (state: { location: { pathname: string } }) => unknown

const mocks = vi.hoisted(() => ({
  pathname: '/',
  getIssue: vi.fn<() => Promise<string | null>>(),
  recover: vi.fn<() => Promise<DesktopNativeRecoveryOutcome>>(),
}))
const { passThrough, nothing } = vi.hoisted(() => ({
  passThrough: ({ children }: { readonly children: ReactNode }) => children,
  nothing: () => null,
}))

vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: LocationSelection }) =>
    select({ location: { pathname: mocks.pathname } }),
}))
vi.mock('@/features/chat/hooks', () => ({
  useBackgroundRunMonitor: vi.fn(),
  useSetupActionTerminalReconciliation: vi.fn(),
}))
vi.mock('@/features/project-actions', () => ({ ActionPanelLayout: passThrough }))
vi.mock('@/features/sidebar/components', () => ({ Sidebar: () => <aside>Sidebar</aside> }))
vi.mock('@/features/terminal', () => ({ useTerminalActivityMonitor: vi.fn() }))
vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getDesktopNativeAdmissionIssue: mocks.getIssue,
    recoverDesktopNativeAdmission: mocks.recover,
  },
}))
vi.mock('../Header', () => ({ Header: () => <header>Header</header> }))
vi.mock('../ToastOverlay', () => ({ ToastOverlay: nothing }))
vi.mock('../useAutoUpdater', () => ({ useAutoUpdater: vi.fn() }))
vi.mock('../useWorkspaceLifecycle', () => ({ useWorkspaceLifecycle: vi.fn() }))
vi.mock('../WorkspaceRightPanel', () => ({ WorkspaceRightPanel: passThrough }))
vi.mock('../WorkspaceTerminal', () => ({ WorkspaceTerminal: nothing }))
vi.mock('../right-panel/RightPanelHost', () => ({ RightPanelHost: nothing }))
vi.mock('../right-panel/RightPanelMaximizePublisher', () => ({
  RightPanelMaximizePublisher: nothing,
}))
vi.mock('../right-panel/RightPanelCommandPalette', () => ({ RightPanelCommandPalette: nothing }))

function follows(node: Node, other: Node) {
  return Boolean(node.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING)
}

beforeEach(() => {
  useDesktopNativeAdmissionStore.setState({ loading: 'idle', notice: { kind: 'hidden' } })
  mocks.getIssue.mockReset().mockResolvedValue('Desktop tools are paused.')
  mocks.recover.mockReset()
})

function renderShell() {
  return render(
    <WorkspaceShell>
      <main>Route content</main>
    </WorkspaceShell>,
  )
}

describe('workspace shell desktop tools notice', () => {
  it('sits below the app header in the workspace', async () => {
    mocks.pathname = '/'
    renderShell()
    const notice = await screen.findByRole('region', { name: 'Desktop tools status' })
    expect(follows(screen.getByText('Header'), notice)).toBe(true)
    expect(follows(notice, screen.getByText('Route content'))).toBe(true)
  })

  it.each(['/settings', '/settings/actions'])(
    'moves below the route at %s, clear of the window controls and the Settings title bar',
    async (pathname) => {
      mocks.pathname = pathname
      renderShell()
      const notice = await screen.findByRole('region', { name: 'Desktop tools status' })
      expect(screen.queryByText('Header')).not.toBeInTheDocument()
      expect(follows(screen.getByText('Route content'), notice)).toBe(true)
      expect(screen.getAllByRole('region', { name: 'Desktop tools status' })).toHaveLength(1)
    },
  )

  it('keeps an in-flight recovery and its result across a Settings round trip', async () => {
    mocks.pathname = '/'
    const result = Promise.withResolvers<DesktopNativeRecoveryOutcome>()
    mocks.recover.mockReturnValue(result.promise)
    const view = renderShell()
    fireEvent.click(await screen.findByRole('button', { name: 'Recover desktop tools' }))
    mocks.pathname = '/settings'
    view.rerender(
      <WorkspaceShell>
        <main>Route content</main>
      </WorkspaceShell>,
    )
    expect(screen.getByRole('button', { name: 'Recovering…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await act(async () =>
      result.resolve({ outcome: 'failed', message: 'Still settling.', retryable: true }),
    )
    mocks.pathname = '/'
    view.rerender(
      <WorkspaceShell>
        <main>Route content</main>
      </WorkspaceShell>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Still settling.')
    // A remounted shell reuses the GUI-lifetime status instead of reading it again.
    view.unmount()
    renderShell()
    expect(screen.getByRole('alert')).toHaveTextContent('Still settling.')
    expect(mocks.getIssue).toHaveBeenCalledOnce()
    expect(mocks.recover).toHaveBeenCalledOnce()
  })
})
