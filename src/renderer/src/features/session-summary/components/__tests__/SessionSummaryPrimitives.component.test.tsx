import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '@/shared/ui/Button'
import {
  SessionSummaryPaginatedList,
  SessionSummaryRow,
  SessionSummarySection,
} from '../SessionSummaryPrimitives'

function DisclosureHarness() {
  const [expanded, setExpanded] = useState(false)
  return (
    <SessionSummarySection
      id="sources"
      title="Sources"
      count={8}
      expanded={expanded}
      onExpandedChange={setExpanded}
    >
      <Button type="button">Open source</Button>
    </SessionSummarySection>
  )
}

describe('Session Summary primitives', () => {
  it('exposes an accessible disclosure relationship and hides collapsed content', () => {
    render(<DisclosureHarness />)

    const disclosure = screen.getByRole('button', { name: 'Sources 8' })
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    expect(disclosure).toHaveAttribute('aria-controls', 'session-summary-section-sources')
    expect(screen.queryByRole('button', { name: 'Open source' })).toBeNull()

    fireEvent.click(disclosure)

    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Open source' })).toBeInTheDocument()
  })

  it('bounds long lists and lets the user reveal or collapse the remainder', () => {
    const items = Array.from({ length: 9 }, (_, index) => `Output ${index + 1}`)
    render(
      <SessionSummaryPaginatedList
        items={items}
        getKey={(item) => item}
        renderItem={(item) => <div>{item}</div>}
      />,
    )

    expect(screen.getByText('Output 6')).toBeInTheDocument()
    expect(screen.queryByText('Output 7')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show 3 more' }))

    expect(screen.getByText('Output 9')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.queryByText('Output 7')).toBeNull()
  })

  it('keeps disabled explanations reachable without invoking the action', () => {
    const onClick = vi.fn()
    render(
      <SessionSummaryRow
        label="Create PR"
        disabledReason="Authenticate GitHub CLI first"
        onClick={onClick}
      />,
    )

    const action = screen.getByRole('button', { name: 'Create PR' })
    expect(action).toHaveAttribute('aria-disabled', 'true')
    expect(action).not.toBeDisabled()
    expect(action).toHaveAccessibleDescription('Authenticate GitHub CLI first')

    fireEvent.click(action)
    expect(onClick).not.toHaveBeenCalled()
  })
})
