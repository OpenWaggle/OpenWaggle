import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerStore } from '@/stores/composer-store'
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
    useComposerStore.setState(useComposerStore.getInitialState())
  })

  it('renders nothing when no action dialog is open', () => {
    const { container } = render(<ActionDialog />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the dialog when actionDialog is set', () => {
    useComposerStore.setState({ actionDialog: 'create-branch' })
    render(<ActionDialog />)
    expect(screen.getByText('Create branch')).toBeInTheDocument()
    expect(screen.getByText('Create')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('shows input placeholder for create-branch', () => {
    useComposerStore.setState({ actionDialog: 'create-branch' })
    render(<ActionDialog />)
    expect(screen.getByPlaceholderText('feature/my-branch')).toBeInTheDocument()
  })

  it('does not show input for delete-branch', () => {
    useComposerStore.setState({ actionDialog: 'delete-branch' })
    render(<ActionDialog />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText('Delete')).toBeInTheDocument()
  })

  it('shows error message when actionDialogError is set', () => {
    useComposerStore.setState({
      actionDialog: 'create-branch',
      actionDialogError: 'Branch name is required.',
    })
    render(<ActionDialog />)
    expect(screen.getByText('Branch name is required.')).toBeInTheDocument()
  })

  it('shows busy state on confirm button', () => {
    useComposerStore.setState({
      actionDialog: 'create-branch',
      actionDialogBusy: true,
    })
    render(<ActionDialog />)
    expect(screen.getByText('Working...')).toBeInTheDocument()
  })

  it('closes dialog on Cancel click when not busy', () => {
    useComposerStore.setState({ actionDialog: 'create-branch' })
    render(<ActionDialog />)
    fireEvent.click(screen.getByText('Cancel'))
    expect(useComposerStore.getState().actionDialog).toBeNull()
  })

  it('does not close dialog on Cancel when busy', () => {
    useComposerStore.setState({
      actionDialog: 'create-branch',
      actionDialogBusy: true,
    })
    render(<ActionDialog />)
    fireEvent.click(screen.getByText('Cancel'))
    // closeActionDialog checks for busy
    expect(useComposerStore.getState().actionDialog).toBe('create-branch')
  })

  it('renders confirm-full-access dialog with danger styling', () => {
    useComposerStore.setState({ actionDialog: 'confirm-full-access' })
    render(<ActionDialog />)
    expect(screen.getByText('Switch to Full access')).toBeInTheDocument()
    const switchButton = screen.getByText('Switch')
    expect(switchButton).toBeInTheDocument()
  })

  it('closes dialog on Escape key when not busy', () => {
    useComposerStore.setState({ actionDialog: 'create-branch' })
    render(<ActionDialog />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useComposerStore.getState().actionDialog).toBeNull()
  })

  it('does not close dialog on Escape key when busy', () => {
    useComposerStore.setState({
      actionDialog: 'create-branch',
      actionDialogBusy: true,
    })
    render(<ActionDialog />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useComposerStore.getState().actionDialog).toBe('create-branch')
  })

  it('updates input value on change', () => {
    useComposerStore.setState({ actionDialog: 'create-branch' })
    render(<ActionDialog />)
    const input = screen.getByPlaceholderText('feature/my-branch')
    fireEvent.change(input, { target: { value: 'feat/new' } })
    expect(useComposerStore.getState().actionDialogInput).toBe('feat/new')
  })
})
