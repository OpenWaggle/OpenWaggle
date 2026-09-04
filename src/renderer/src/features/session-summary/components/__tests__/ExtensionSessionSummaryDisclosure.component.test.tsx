import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionSessionSummarySections } from '../ExtensionSessionSummarySections'
import { PROJECT_PATH, registry, summaryEntry } from './extension-session-summary-test-fixtures'

describe('ExtensionSessionSummarySections disclosure', () => {
  beforeEach(() => localStorage.clear())

  afterEach(() => vi.useRealTimers())

  it('uses the declarative default disclosure and exposes an accessible toggle', () => {
    const collapsedEntry = {
      ...summaryEntry(),
      contributionId: 'collapsed',
      title: 'Collapsed status',
      sessionSummary: {
        placement: 'details',
        disclosure: { defaultExpanded: false },
        rows: [{ id: 'status', label: 'Status', value: 'Ready' }],
      },
    } satisfies ExtensionContributionRegistryEntry

    render(
      <ExtensionSessionSummarySections
        registry={registry([collapsedEntry])}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[]}
        onOpenResources={vi.fn()}
      />,
    )

    const toggle = screen.getByRole('button', { name: 'Collapsed status 1' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls')

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps a non-collapsible disclosure expanded without exposing a false control', () => {
    const fixedEntry = {
      ...summaryEntry(),
      contributionId: 'fixed',
      title: 'Fixed status',
      sessionSummary: {
        placement: 'details',
        disclosure: { defaultExpanded: false, collapsible: false },
        rows: [{ id: 'status', label: 'Status', value: 'Always visible' }],
      },
    } satisfies ExtensionContributionRegistryEntry

    render(
      <ExtensionSessionSummarySections
        registry={registry([fixedEntry])}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[]}
        onOpenResources={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: /Fixed status/ })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Fixed status' })).toBeInTheDocument()
    expect(screen.getByText('Always visible')).toBeInTheDocument()
  })

  it('auto-collapses an expanded disclosure after its declared delay', () => {
    vi.useFakeTimers()
    const timedEntry = {
      ...summaryEntry(),
      contributionId: 'timed',
      title: 'Timed status',
      sessionSummary: {
        placement: 'details',
        disclosure: { defaultExpanded: true, autoCollapseAfterMs: 1_000 },
        rows: [{ id: 'status', label: 'Status', value: 'Complete' }],
      },
    } satisfies ExtensionContributionRegistryEntry

    render(
      <ExtensionSessionSummarySections
        registry={registry([timedEntry])}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[]}
        onOpenResources={vi.fn()}
      />,
    )

    const toggle = screen.getByRole('button', { name: 'Timed status 1' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    act(() => vi.advanceTimersByTime(999))
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    act(() => vi.advanceTimersByTime(1))
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('persists disclosure choice for the owning Session without leaking it to another', () => {
    const persistentEntry = {
      ...summaryEntry(),
      contributionId: 'persistent',
      title: 'Persistent status',
      sessionSummary: {
        placement: 'details',
        disclosure: { defaultExpanded: false },
        rows: [{ id: 'status', label: 'Status', value: 'Ready' }],
      },
    } satisfies ExtensionContributionRegistryEntry
    const view = registry([persistentEntry])

    const first = render(
      <ExtensionSessionSummarySections
        registry={view}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[]}
        onOpenResources={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Persistent status 1' }))
    expect(screen.getByRole('button', { name: 'Persistent status 1' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    first.unmount()

    const restored = render(
      <ExtensionSessionSummarySections
        registry={view}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[]}
        onOpenResources={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Persistent status 1' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    restored.unmount()

    render(
      <ExtensionSessionSummarySections
        registry={view}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-two"
        messageCount={1}
        placement="details"
        resources={[]}
        onOpenResources={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Persistent status 1' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })
})
