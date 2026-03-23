import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerActionStore } from '@/stores/composer-action-store'
import { useComposerStore } from '@/stores/composer-store'
import { useGitStore } from '@/stores/git-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { BranchPicker } from '../BranchPicker'

vi.mock('@/lib/ipc', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({ ok: true }),
    getGitStatus: vi.fn().mockResolvedValue(null),
    listGitBranches: vi.fn().mockResolvedValue(null),
    checkoutGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'Checked out' }),
    createGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    renameGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    deleteGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    setGitBranchUpstream: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
  },
}))

describe('BranchPicker', () => {
  beforeEach(() => {
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
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, projectPath: null },
    })
    const { container } = render(<BranchPicker />)
    expect(container.firstChild).toBeNull()
  })

  it('renders branch chip with current branch name', () => {
    render(<BranchPicker />)
    expect(screen.getByText('main')).toBeInTheDocument()
  })

  it('opens branch menu on click', () => {
    render(<BranchPicker />)
    fireEvent.click(screen.getByTitle('Manage branches'))
    expect(useComposerStore.getState().branchMenuOpen).toBe(true)
    expect(screen.getByPlaceholderText('Search branches')).toBeInTheDocument()
  })

  it('shows local and remote branches in menu', () => {
    useComposerStore.setState({ branchMenuOpen: true })
    render(<BranchPicker />)
    expect(screen.getByText('Local')).toBeInTheDocument()
    expect(screen.getByText('Remote')).toBeInTheDocument()
    expect(screen.getByText('develop')).toBeInTheDocument()
    expect(screen.getByText('origin/main')).toBeInTheDocument()
  })

  it('filters branches by search query', () => {
    useComposerStore.setState({ branchMenuOpen: true })
    useComposerActionStore.setState({ branchQuery: 'dev' })
    render(<BranchPicker />)
    expect(screen.getByText('develop')).toBeInTheDocument()
    expect(screen.queryByText('origin/main')).toBeNull()
  })

  it('shows no branches message when filter yields nothing', () => {
    useComposerStore.setState({ branchMenuOpen: true })
    useComposerActionStore.setState({ branchQuery: 'nonexistent' })
    render(<BranchPicker />)
    expect(screen.getByText('No branches found.')).toBeInTheDocument()
  })

  it('renders action buttons in menu', () => {
    useComposerStore.setState({ branchMenuOpen: true })
    render(<BranchPicker />)
    expect(screen.getByText('Create')).toBeInTheDocument()
    expect(screen.getByText('Rename')).toBeInTheDocument()
    expect(screen.getByText('Delete current')).toBeInTheDocument()
    expect(screen.getByText('Upstream')).toBeInTheDocument()
  })

  it('opens create-branch dialog on Create click', () => {
    useComposerStore.setState({ branchMenuOpen: true })
    render(<BranchPicker />)
    fireEvent.click(screen.getByText('Create'))
    expect(useComposerActionStore.getState().actionDialog).toBe('create-branch')
  })

  it('opens delete dialog for the selected local branch row action', () => {
    useComposerStore.setState({ branchMenuOpen: true })
    render(<BranchPicker />)
    fireEvent.click(screen.getByTitle('Delete "develop"'))
    expect(useComposerActionStore.getState().actionDialog).toBe('delete-branch')
    expect(useComposerActionStore.getState().actionDialogInput).toBe('develop')
  })

  it('renders refresh button', () => {
    render(<BranchPicker />)
    expect(screen.getByTitle('Refresh git status')).toBeInTheDocument()
  })

  it('marks current branch with indicator', () => {
    useComposerStore.setState({ branchMenuOpen: true })
    render(<BranchPicker />)
    // "main" is current, should have the ● indicator
    const mainButtons = screen.getAllByRole('button')
    const mainBranch = mainButtons.find(
      (b) => b.textContent?.includes('main') && b.textContent?.includes('●'),
    )
    expect(mainBranch).toBeTruthy()
  })
})
