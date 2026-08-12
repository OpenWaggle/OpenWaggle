import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerActionStore } from '@/features/composer/state/composer-action-store'
import { useComposerStore } from '@/features/composer/state/composer-store'
import type { SessionContextRowState } from '@/features/git'
import { useGitStore } from '@/features/git/state'
import { usePreferencesStore } from '@/features/settings/state'
import { RunTargetPicker } from '../RunTargetPicker'

const copyToClipboard = vi.fn()

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({ ok: true }),
    getGitStatus: vi.fn().mockResolvedValue(null),
    listGitBranches: vi.fn().mockResolvedValue(null),
    checkoutGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'Checked out' }),
    createGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    copyToClipboard: (text: string) => copyToClipboard(text),
  },
}))

function stripState(overrides: Partial<SessionContextRowState> = {}): SessionContextRowState {
  return {
    visible: true,
    envMode: 'worktree',
    baseRef: 'main',
    startFromOrigin: false,
    branchNames: ['main', 'develop'],
    changeRequests: [],
    sendPlan: { kind: 'create-worktree', baseRef: 'main' },
    setEnvMode: vi.fn(),
    setBaseRef: vi.fn(),
    setStartFromOrigin: vi.fn(),
    loadChangeRequests: vi.fn(async () => {}),
    checkoutChangeRequest: vi.fn(async () => true),
    ...overrides,
  }
}

describe('RunTargetPicker', () => {
  beforeEach(() => {
    copyToClipboard.mockClear()
    useComposerStore.setState(useComposerStore.getInitialState())
    useComposerActionStore.setState(useComposerActionStore.getInitialState())
    usePreferencesStore.setState({
      ...usePreferencesStore.getInitialState(),
      settings: { ...DEFAULT_SETTINGS, projectPath: '/test/project' },
      isLoaded: true,
    })
    useGitStore.setState({
      ...useGitStore.getInitialState(),
      status: {
        branch: 'main',
        additions: 0,
        deletions: 0,
        filesChanged: 0,
        changedFiles: [],
        clean: true,
        ahead: 0,
        behind: 0,
      },
      branches: {
        branches: [
          { name: 'main', fullName: 'main', isCurrent: true, isRemote: false },
          { name: 'develop', fullName: 'develop', isCurrent: false, isRemote: false },
          { name: 'origin/main', fullName: 'origin/main', isCurrent: false, isRemote: true },
        ],
      },
    })
  })

  it('renders nothing when no project path', () => {
    usePreferencesStore.setState({ settings: { ...DEFAULT_SETTINGS, projectPath: null } })
    const { container } = render(<RunTargetPicker strip={stripState()} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the checked-out branch as the run target in local mode', () => {
    render(<RunTargetPicker strip={stripState({ envMode: 'local' })} />)
    expect(screen.getByRole('button', { name: 'Run target: main' })).toBeInTheDocument()
  })

  it('shows the base ref as the run target in worktree mode', () => {
    render(<RunTargetPicker strip={stripState({ baseRef: 'develop' })} />)
    expect(screen.getByRole('button', { name: 'Run target: develop' })).toBeInTheDocument()
  })

  it('flags a missing base ref on the trigger', () => {
    render(<RunTargetPicker strip={stripState({ baseRef: null })} />)
    expect(screen.getByRole('button', { name: 'Run target: Select a branch' })).toBeInTheDocument()
  })

  it('opens the menu on click and offers ref search', () => {
    render(<RunTargetPicker strip={stripState()} />)
    fireEvent.click(screen.getByRole('button', { name: /Run target/ }))
    expect(useComposerStore.getState().branchMenuOpen).toBe(true)
    expect(screen.getByPlaceholderText('Search branches')).toBeInTheDocument()
  })

  it('lists local and remote refs', () => {
    useComposerStore.setState({ branchMenuOpen: true })
    render(<RunTargetPicker strip={stripState()} />)
    expect(screen.getByText('Local')).toBeInTheDocument()
    expect(screen.getByText('Remote')).toBeInTheDocument()
    expect(screen.getByText('develop')).toBeInTheDocument()
    expect(screen.getByText('origin/main')).toBeInTheDocument()
  })

  it('filters refs by search query', () => {
    useComposerStore.setState({ branchMenuOpen: true })
    useComposerActionStore.setState({ branchQuery: 'dev' })
    render(<RunTargetPicker strip={stripState()} />)
    expect(screen.getByText('develop')).toBeInTheDocument()
    expect(screen.queryByText('origin/main')).toBeNull()
  })

  it('shows an empty state when the filter matches nothing', () => {
    useComposerStore.setState({ branchMenuOpen: true })
    useComposerActionStore.setState({ branchQuery: 'nonexistent' })
    render(<RunTargetPicker strip={stripState()} />)
    expect(screen.getByText('No branches found.')).toBeInTheDocument()
  })

  // The whole point of merging the two controls: in worktree mode the highlighted
  // ref is the base to branch from, which is usually NOT the checked-out branch.
  it('marks the base ref as selected in worktree mode, not the checked-out branch', () => {
    useComposerStore.setState({ branchMenuOpen: true })
    render(<RunTargetPicker strip={stripState({ baseRef: 'develop' })} />)
    expect(screen.getByRole('button', { name: /^develop/ })).toHaveAttribute('aria-current', 'true')
    // Absent rather than "false", so screen readers do not announce every other row.
    expect(screen.getByRole('button', { name: /^main/ })).not.toHaveAttribute('aria-current')
  })

  it('sets the base ref instead of checking out when creating a worktree', () => {
    const setBaseRef = vi.fn()
    useComposerStore.setState({ branchMenuOpen: true })
    render(<RunTargetPicker strip={stripState({ setBaseRef })} />)
    fireEvent.click(screen.getByRole('button', { name: /^develop/ }))
    expect(setBaseRef).toHaveBeenCalledWith('develop')
    expect(useComposerStore.getState().branchMenuOpen).toBe(false)
  })

  // Guards the mode branch in selectRef: without this, removing the worktree early
  // return would silently turn every base-ref pick into a checkout with no test failing.
  it('checks the ref out instead of setting a base ref when running in place', async () => {
    const setBaseRef = vi.fn()
    useComposerStore.setState({ branchMenuOpen: true })
    render(<RunTargetPicker strip={stripState({ envMode: 'local', setBaseRef })} />)

    fireEvent.click(screen.getByRole('button', { name: /^develop/ }))

    const { api } = await import('@/shared/lib/ipc')
    expect(api.checkoutGitBranch).toHaveBeenCalledWith('/test/project', { name: 'develop' })
    expect(setBaseRef).not.toHaveBeenCalled()
  })

  it('opens the create-branch dialog from the menu', () => {
    useComposerStore.setState({ branchMenuOpen: true })
    render(<RunTargetPicker strip={stripState()} />)
    fireEvent.click(screen.getByRole('button', { name: 'New branch…' }))
    expect(useComposerActionStore.getState().actionDialog).toBe('create-branch')
  })

  it('copies the run target ref', () => {
    useComposerStore.setState({ branchMenuOpen: true })
    render(<RunTargetPicker strip={stripState({ baseRef: 'develop' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy branch name' }))
    expect(copyToClipboard).toHaveBeenCalledWith('develop')
  })

  it('exposes start-from-origin only when a worktree will be created', () => {
    const setStartFromOrigin = vi.fn()
    useComposerStore.setState({ branchMenuOpen: true })
    const { unmount } = render(<RunTargetPicker strip={stripState({ setStartFromOrigin })} />)
    fireEvent.click(screen.getByRole('switch', { name: 'Start from origin' }))
    expect(setStartFromOrigin).toHaveBeenCalledWith(true)
    unmount()

    render(<RunTargetPicker strip={stripState({ envMode: 'local' })} />)
    expect(screen.queryByRole('switch', { name: 'Start from origin' })).not.toBeInTheDocument()
  })

  it('loads change requests when the checkout control is clicked', () => {
    const loadChangeRequests = vi.fn(async () => {})
    useComposerStore.setState({ branchMenuOpen: true })
    render(<RunTargetPicker strip={stripState({ loadChangeRequests })} />)
    fireEvent.click(screen.getByRole('button', { name: /checkout change request/i }))
    expect(loadChangeRequests).toHaveBeenCalled()
  })

  it('checks out a selected change request', () => {
    const checkoutChangeRequest = vi.fn(async () => true)
    useComposerStore.setState({ branchMenuOpen: true })
    render(
      <RunTargetPicker
        strip={stripState({
          checkoutChangeRequest,
          changeRequests: [
            {
              title: 'Fix bug',
              url: 'https://x/1',
              baseRef: 'main',
              headRef: 'fix',
              state: 'open',
            },
          ],
        })}
      />,
    )
    fireEvent.change(screen.getByLabelText('Checkout change request'), {
      target: { value: 'fix' },
    })
    expect(checkoutChangeRequest).toHaveBeenCalledWith('fix')
  })
})
