import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CompactionTimelineRow } from '../CompactionTimelineRow'

describe('CompactionTimelineRow', () => {
  it('matches Codex automatic-compaction copy while running and after completion', () => {
    const { rerender } = render(<CompactionTimelineRow state="automatic-running" />)

    const running = screen.getByText('Context automatically compacting')
    expect(running).toHaveClass('compaction-shimmer')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()

    rerender(<CompactionTimelineRow state="automatic-complete" />)

    expect(screen.getByText('Context automatically compacted')).toBeInTheDocument()
    expect(screen.queryByText('Context automatically compacting')).not.toBeInTheDocument()
  })

  it('uses Codex manual-compaction copy', () => {
    const { rerender } = render(<CompactionTimelineRow state="manual-running" />)
    expect(screen.getByText('Compacting context')).toBeInTheDocument()

    rerender(<CompactionTimelineRow state="manual-complete" />)
    expect(screen.getByText('Context compacted')).toBeInTheDocument()
  })

  it('keeps durable history accessible while transient rows rely on the live announcer', () => {
    const { rerender } = render(<CompactionTimelineRow state="automatic-running" />)
    expect(
      screen.getByText('Context automatically compacting').closest('[aria-hidden]'),
    ).toHaveAttribute('aria-hidden', 'true')

    rerender(<CompactionTimelineRow accessible state="automatic-complete" />)
    expect(screen.getByText('Context automatically compacted').closest('div')).not.toHaveAttribute(
      'aria-hidden',
    )
  })
})
