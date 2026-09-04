import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CommitMessageDialog } from '@/features/git'

describe('CommitMessageDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <CommitMessageDialog open={false} fileCount={1} onCancel={vi.fn()} onConfirm={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('blocks confirm until a non-empty message is entered', () => {
    const onConfirm = vi.fn()
    render(<CommitMessageDialog open fileCount={2} onCancel={vi.fn()} onConfirm={onConfirm} />)
    const confirm = screen.getByRole('button', { name: 'Continue' })
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByRole('textbox', { name: 'Commit message' }), {
      target: { value: '  ' },
    })
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    fireEvent.change(screen.getByRole('textbox', { name: 'Commit message' }), {
      target: { value: ' fix: thing ' },
    })
    screen.getByRole('button', { name: 'Continue' }).click()
    expect(onConfirm).toHaveBeenCalledWith('fix: thing')
  })

  it('reports the number of files being committed', () => {
    render(<CommitMessageDialog open fileCount={3} onCancel={vi.fn()} onConfirm={vi.fn()} />)
    expect(
      screen.getByText('3 changed files in the working tree will be committed.'),
    ).toBeInTheDocument()
  })
})
