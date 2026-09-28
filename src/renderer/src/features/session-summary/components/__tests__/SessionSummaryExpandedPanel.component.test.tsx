import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionSummaryExpandedPanel } from '../SessionSummaryExpandedPanel'

function ExplodingSection(): ReactNode {
  throw new Error('broken contribution')
}

describe('SessionSummaryExpandedPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a compact floating section stack in the supplied order', () => {
    render(
      <SessionSummaryExpandedPanel
        input={{
          panelId: 'session-summary-session-1',
          sessionId: 'session-1',
          transient: false,
          sections: [
            { id: 'environment', label: 'Environment', content: <div>Environment content</div> },
            { id: 'sources', label: 'Sources', content: <div>Sources content</div> },
          ],
        }}
      />,
    )

    const panel = screen.getByRole('complementary', { name: 'Session Summary' })
    expect(panel).toHaveAttribute('data-native-preview-occluder', 'session-1')
    expect(panel).toHaveClass('w-75', 'rounded-3xl', 'overflow-hidden')
    expect(screen.queryByRole('button', { name: 'Collapse Session Summary' })).toBeNull()
    expect(screen.getAllByText(/content$/).map((element) => element.textContent)).toEqual([
      'Environment content',
      'Sources content',
    ])
  })

  it('isolates a failing section without hiding healthy session information', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <SessionSummaryExpandedPanel
        input={{
          panelId: 'session-summary-session-1',
          sessionId: 'session-1',
          transient: false,
          sections: [
            { id: 'broken', label: 'Broken', content: <ExplodingSection /> },
            { id: 'sources', label: 'Sources', content: <div>Sources remain available</div> },
          ],
        }}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Broken panel error')
    expect(screen.getByText('Sources remain available')).toBeInTheDocument()
  })
})

function renderPanel(sessionId: string) {
  return render(
    <SessionSummaryExpandedPanel
      input={{ panelId: `panel-${sessionId}`, sessionId, sections: [], transient: false }}
    />,
  )
}

const animates = () =>
  screen
    .getByRole('complementary', { name: 'Session Summary' })
    .className.includes('session-summary-panel-enter')

describe('SessionSummaryExpandedPanel entrance', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not slide in again when the chat surface remounts it right away', () => {
    vi.useFakeTimers()
    const first = renderPanel('session-remount')
    expect(animates()).toBe(true)
    first.unmount()

    renderPanel('session-remount')
    expect(animates()).toBe(false)
  })

  it('still animates a panel reopened after a real pause', () => {
    vi.useFakeTimers()
    const first = renderPanel('session-reopen')
    first.unmount()
    vi.advanceTimersByTime(5_000)

    renderPanel('session-reopen')
    expect(animates()).toBe(true)
  })
})
