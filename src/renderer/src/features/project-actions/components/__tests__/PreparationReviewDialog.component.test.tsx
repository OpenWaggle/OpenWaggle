import type { ActionCatalog, PreparationReview } from '@shared/types/action-definitions'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PreparationReviewDialog } from '../PreparationReviewDialog'

const invocation = { type: 'command', command: 'pnpm install', directory: '.' } as const
const previousReview: PreparationReview = {
  definitionId: 'setup',
  fingerprint: 'old-review',
  invocation,
  enabled: true,
  profileId: 'opt-in',
  profileName: 'Opt in',
}
const entry: ActionCatalog['preparation'][number] = {
  source: 'project',
  definition: { id: 'setup', profileId: 'default', phase: 'setup', invocation },
  review: 'required',
  previous: previousReview,
}

describe('PreparationReviewDialog', () => {
  it('shows both profiles when an unchanged shared command moves into Default', () => {
    const onDecide = vi.fn()
    render(
      <PreparationReviewDialog
        entry={entry}
        currentProfileName="Default"
        busy={false}
        onDecide={onDecide}
        onClose={vi.fn()}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Review workspace setup' })
    expect(within(dialog).getByText('Opt in (opt-in)', { exact: true })).toBeInTheDocument()
    expect(within(dialog).getByText('Default (default)', { exact: true })).toBeInTheDocument()
    expect(dialog).toHaveTextContent('This changes which new worktrees run it automatically.')
    expect(within(dialog).getAllByText('pnpm install')).toHaveLength(2)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enable this version' }))
    expect(onDecide).toHaveBeenCalledWith(true)
  })

  it('does not invent an old profile for a review saved before profile context existed', () => {
    render(
      <PreparationReviewDialog
        entry={{
          ...entry,
          previous: { ...previousReview, profileId: undefined, profileName: undefined },
        }}
        currentProfileName="Default"
        busy={false}
        onDecide={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Review workspace setup' })
    expect(within(dialog).getByText('Not recorded')).toBeInTheDocument()
    expect(within(dialog).getByText('Default (default)')).toBeInTheDocument()
  })
})
