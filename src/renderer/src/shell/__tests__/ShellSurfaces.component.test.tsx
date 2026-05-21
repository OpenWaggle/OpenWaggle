import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '@/shared/ui/Button'
import { FeedbackButton } from '../HeaderFeedbackButton'
import { useUIStore } from '../ui-store'
import { useFullscreen } from '../useFullscreen'
import { WorkspaceShell } from '../WorkspaceShell'
import { WorkspaceTerminal } from '../WorkspaceTerminal'

type FullscreenHandler = (isFullscreen: boolean) => void

const shellMocks = vi.hoisted(() => {
  let fullscreenHandler: FullscreenHandler | null = null
  const unsubscribeFullscreen = vi.fn()
  return {
    backgroundRunMonitor: vi.fn(),
    autoUpdater: vi.fn(),
    getFullscreenHandler: () => fullscreenHandler,
    projectPath: '/repo',
    unsubscribeFullscreen,
    workspaceLifecycle: vi.fn(),
    onFullscreenChanged: vi.fn((handler: FullscreenHandler) => {
      fullscreenHandler = handler
      return unsubscribeFullscreen
    }),
  }
})

vi.mock('@/features/chat/hooks', () => ({
  useBackgroundRunMonitor: () => shellMocks.backgroundRunMonitor(),
}))

vi.mock('@/features/feedback/components', () => ({
  FeedbackModal: () => <div>Feedback modal</div>,
}))

vi.mock('@/features/sessions/hooks', () => ({
  useProject: () => ({ projectPath: shellMocks.projectPath }),
}))

vi.mock('@/features/sidebar/components', () => ({
  Sidebar: () => <aside>Sidebar</aside>,
}))

vi.mock('@/features/terminal/components', () => ({
  TerminalPanel: ({
    projectPath,
    onClose,
  }: {
    readonly projectPath: string | null
    readonly onClose: () => void
  }) => (
    <section>
      Terminal for {projectPath ?? 'none'}
      <Button variant="unstyled" type="button" onClick={onClose}>
        Close terminal
      </Button>
    </section>
  ),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    onFullscreenChanged: shellMocks.onFullscreenChanged,
  },
}))

vi.mock('../Header', () => ({ Header: () => <header>Header</header> }))
vi.mock('../ToastOverlay', () => ({ ToastOverlay: () => <div>Toasts</div> }))
vi.mock('../useAutoUpdater', () => ({ useAutoUpdater: () => shellMocks.autoUpdater() }))
vi.mock('../useWorkspaceLifecycle', () => ({
  useWorkspaceLifecycle: () => shellMocks.workspaceLifecycle(),
}))

describe('shell surfaces', () => {
  beforeEach(() => {
    useUIStore.setState({ feedbackModalOpen: false, terminalOpen: false })
    shellMocks.backgroundRunMonitor.mockClear()
    shellMocks.autoUpdater.mockClear()
    shellMocks.workspaceLifecycle.mockClear()
    shellMocks.onFullscreenChanged.mockClear()
    shellMocks.unsubscribeFullscreen.mockClear()
  })

  it('opens the feedback callback from the header button', () => {
    const onOpen = vi.fn()

    render(<FeedbackButton onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Report a bug' }))

    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('mounts workspace chrome, lifecycle hooks, terminal, and feedback modal from store state', () => {
    useUIStore.setState({ feedbackModalOpen: true, terminalOpen: true })

    render(
      <WorkspaceShell>
        <main>Route content</main>
      </WorkspaceShell>,
    )

    expect(screen.getByText('Sidebar')).toBeInTheDocument()
    expect(screen.getByText('Header')).toBeInTheDocument()
    expect(screen.getByText('Route content')).toBeInTheDocument()
    expect(screen.getByText('Terminal for /repo')).toBeInTheDocument()
    expect(screen.getByText('Feedback modal')).toBeInTheDocument()
    expect(shellMocks.workspaceLifecycle).toHaveBeenCalledOnce()
    expect(shellMocks.backgroundRunMonitor).toHaveBeenCalledOnce()
    expect(shellMocks.autoUpdater).toHaveBeenCalledOnce()
  })

  it('closes the workspace terminal through the terminal panel close action', () => {
    useUIStore.setState({ terminalOpen: true })

    render(<WorkspaceTerminal />)
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }))

    expect(useUIStore.getState().terminalOpen).toBe(false)
  })

  it('tracks fullscreen state from the preload event subscription and cleans up on unmount', () => {
    const { result, unmount } = renderHook(() => useFullscreen())
    const fullscreenHandler = shellMocks.getFullscreenHandler()
    if (!fullscreenHandler) {
      throw new Error('Expected fullscreen handler to be registered')
    }

    act(() => fullscreenHandler(true))

    expect(result.current).toBe(true)
    unmount()
    expect(shellMocks.unsubscribeFullscreen).toHaveBeenCalledOnce()
  })
})
