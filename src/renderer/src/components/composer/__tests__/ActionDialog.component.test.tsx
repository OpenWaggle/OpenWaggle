import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerActionStore } from '../../../stores/composer-action-store'
import { useGitStore } from '../../../stores/git-store'
import { ActionDialog } from '../ActionDialog'

vi.mock('@/lib/ipc', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({ ok: true }),
    getGitStatus: vi.fn().mockResolvedValue(null),
    listGitBranches: vi.fn().mockResolvedValue(null),
    checkoutGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    createGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    renameGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    deleteGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    setGitBranchUpstream: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
  },
}))

describe('ActionDialog', () => {
  beforeEach(() => {
    useComposerActionStore.setState(useComposerActionStore.getInitialState())
    useGitStore.setState(useGitStore.getInitialState())
  })

  it('renders nothing when no action dialog is open', () => {
    const { container } = render(<ActionDialog />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the dialog when actionDialog is set', () => {
    useComposerActionStore.setState({ actionDialog: 'create-branch' })
    render(<ActionDialog />)
    expect(screen.getByText('Create branch')).toBeInTheDocument()
    expect(screen.getByText('Create')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('shows input placeholder for create-branch', () => {
    useComposerActionStore.setState({ actionDialog: 'create-branch' })
    render(<ActionDialog />)
    expect(screen.getByPlaceholderText('feature/my-branch')).toBeInTheDocument()
  })

  it('does not show input for delete-branch', () => {
    useComposerActionStore.setState({ actionDialog: 'delete-branch' })
    render(<ActionDialog />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('shows error message when actionDialogError is set', () => {
    useComposerActionStore.setState({
      actionDialog: 'create-branch',
      actionDialogError: 'Branch name is required.',
    })
    render(<ActionDialog />)
    expect(screen.getByText('Branch name is required.')).toBeInTheDocument()
  })

  it('shows busy state on confirm button', () => {
    useComposerActionStore.setState({
      actionDialog: 'create-branch',
      actionDialogBusy: true,
    })
    render(<ActionDialog />)
    expect(screen.getByText('Working...')).toBeInTheDocument()
  })

  it('closes dialog on Cancel click when not busy', () => {
    useComposerActionStore.setState({ actionDialog: 'create-branch' })
    render(<ActionDialog />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(useComposerActionStore.getState().actionDialog).toBeNull()
  })

  it('does not close dialog on Cancel when busy', () => {
    useComposerActionStore.setState({
      actionDialog: 'create-branch',
      actionDialogBusy: true,
    })
    render(<ActionDialog />)
    fireEvent.click(screen.getByText('Cancel'))
    // closeActionDialog checks for busy
    expect(useComposerActionStore.getState().actionDialog).toBe('create-branch')
  })

  it('closes dialog on Escape key when not busy', () => {
    useComposerActionStore.setState({ actionDialog: 'create-branch' })
    render(<ActionDialog />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useComposerActionStore.getState().actionDialog).toBeNull()
  })

  it('does not close dialog on Escape key when busy', () => {
    useComposerActionStore.setState({
      actionDialog: 'create-branch',
      actionDialogBusy: true,
    })
    render(<ActionDialog />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useComposerActionStore.getState().actionDialog).toBe('create-branch')
  })

  it('updates input value on change', () => {
    useComposerActionStore.setState({ actionDialog: 'create-branch' })
    render(<ActionDialog />)
    const input = screen.getByPlaceholderText('feature/my-branch')
    fireEvent.change(input, { target: { value: 'feat/new' } })
    expect(useComposerActionStore.getState().actionDialogInput).toBe('feat/new')
  })

  it('blocks deleting the currently checked out branch', () => {
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
    })
    useComposerActionStore.setState({
      actionDialog: 'delete-branch',
      actionDialogInput: 'main',
    })
    render(<ActionDialog />)
    fireEvent.click(screen.getByText('Delete'))
    expect(
      screen.getByText(
        'Cannot delete the currently checked out branch. Checkout another branch first.',
      ),
    ).toBeInTheDocument()
  })
})
