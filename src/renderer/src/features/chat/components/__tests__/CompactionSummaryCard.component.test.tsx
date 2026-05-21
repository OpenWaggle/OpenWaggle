import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../StreamingText', () => ({
  StreamingText: ({ text }: { readonly text: string }) => (
    <div data-testid="summary-markdown">{text}</div>
  ),
}))

import { CompactionSummaryCard } from '../CompactionSummaryCard'

describe('CompactionSummaryCard', () => {
  it('renders collapsed by default and expands the generated summary inline', () => {
    render(
      <CompactionSummaryCard
        summary={'## Goal\nKeep the failing compaction test context.'}
        tokensBefore={123456}
      />,
    )

    expect(screen.getByText('Compaction')).toBeInTheDocument()
    expect(screen.getByText('Compacted from 123k tokens')).toBeInTheDocument()
    expect(screen.queryByTestId('summary-markdown')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand compaction summary' }))

    expect(screen.getByTestId('summary-markdown')).toHaveTextContent(
      'Keep the failing compaction test context.',
    )
  })
})
