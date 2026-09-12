import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtensionSessionSummarySections } from '../ExtensionSessionSummarySections'
import { PROJECT_PATH, registry, summaryEntry } from './extension-session-summary-test-fixtures'

describe('ExtensionSessionSummarySections states', () => {
  beforeEach(() => localStorage.clear())

  it('omits an empty section once its declarative state is ready', () => {
    const emptyReadyEntry = {
      ...summaryEntry(),
      contributionId: 'empty-ready',
      title: 'Empty ready status',
      sessionSummary: {
        placement: 'details',
        state: { status: 'ready' },
        rows: [],
      },
    } satisfies ExtensionContributionRegistryEntry

    render(
      <ExtensionSessionSummarySections
        registry={registry([emptyReadyEntry])}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[]}
        onOpenResources={vi.fn()}
      />,
    )

    expect(screen.queryByText('Empty ready status')).toBeNull()
  })

  it('keeps an empty loading section visible and announces its message', () => {
    const loadingEntry = {
      ...summaryEntry(),
      contributionId: 'loading',
      title: 'Deployment status',
      sessionSummary: {
        placement: 'details',
        state: { status: 'loading', message: 'Refreshing deployment data' },
        rows: [],
      },
    } satisfies ExtensionContributionRegistryEntry

    render(
      <ExtensionSessionSummarySections
        registry={registry([loadingEntry])}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[]}
        onOpenResources={vi.fn()}
      />,
    )

    expect(screen.getByText('Deployment status')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Refreshing deployment data')
  })

  it('announces live sections without hiding their current rows', () => {
    const liveEntry = {
      ...summaryEntry(),
      contributionId: 'live',
      title: 'Preview watcher',
      sessionSummary: {
        placement: 'details',
        state: { status: 'live', message: 'Watching this Session' },
        rows: [{ id: 'last-event', label: 'Last event', value: 'Build completed' }],
      },
    } satisfies ExtensionContributionRegistryEntry

    render(
      <ExtensionSessionSummarySections
        registry={registry([liveEntry])}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[]}
        onOpenResources={vi.fn()}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Watching this Session')
    expect(screen.getByText('Build completed')).toBeInTheDocument()
  })

  it('isolates a failed extension section from healthy sibling sections', () => {
    const failedEntry = {
      ...summaryEntry(),
      contributionId: 'failure',
      title: 'Broken status',
      sessionSummary: {
        placement: 'details',
        state: { status: 'failure', message: 'Status provider unavailable' },
        rows: [],
      },
    } satisfies ExtensionContributionRegistryEntry

    render(
      <ExtensionSessionSummarySections
        registry={registry([failedEntry, summaryEntry()])}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[]}
        onOpenResources={vi.fn()}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Status provider unavailable')
    expect(screen.getByText('Build status')).toBeInTheDocument()
    expect(screen.getByText('Ready')).toBeInTheDocument()
  })

  it('removes an empty live section as soon as it reports ready', () => {
    const liveEntry = {
      ...summaryEntry(),
      contributionId: 'transitioning',
      title: 'Transitioning status',
      sessionSummary: {
        placement: 'details',
        state: { status: 'live', message: 'Watching' },
        rows: [],
      },
    } satisfies ExtensionContributionRegistryEntry
    const rendered = render(
      <ExtensionSessionSummarySections
        registry={registry([liveEntry])}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[]}
        onOpenResources={vi.fn()}
      />,
    )
    expect(screen.getByText('Transitioning status')).toBeInTheDocument()

    rendered.rerender(
      <ExtensionSessionSummarySections
        registry={registry([
          {
            ...liveEntry,
            sessionSummary: {
              placement: 'details',
              state: { status: 'ready' },
              rows: [],
            },
          },
        ])}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[]}
        onOpenResources={vi.fn()}
      />,
    )
    expect(screen.queryByText('Transitioning status')).toBeNull()
  })

  it('keeps its live region mounted before an empty ready section starts loading', () => {
    const readyEntry = {
      ...summaryEntry(),
      contributionId: 'stable-announcer',
      title: 'Stable status',
      sessionSummary: {
        placement: 'details',
        state: { status: 'ready' },
        rows: [],
      },
    } satisfies ExtensionContributionRegistryEntry
    const rendered = render(
      <ExtensionSessionSummarySections
        registry={registry([readyEntry])}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[]}
        onOpenResources={vi.fn()}
      />,
    )
    const status = screen.getByRole('status')
    expect(status).toBeEmptyDOMElement()
    expect(screen.queryByText('Stable status')).toBeNull()

    rendered.rerender(
      <ExtensionSessionSummarySections
        registry={registry([
          {
            ...readyEntry,
            sessionSummary: {
              placement: 'details',
              state: { status: 'loading', message: 'Loading the latest status' },
              rows: [],
            },
          },
        ])}
        projectPaths={[PROJECT_PATH]}
        sessionId="session-one"
        messageCount={1}
        placement="details"
        resources={[]}
        onOpenResources={vi.fn()}
      />,
    )

    expect(screen.getByRole('status')).toBe(status)
    expect(status).toHaveTextContent('Loading the latest status')
    expect(screen.getByText('Stable status')).toBeInTheDocument()
  })
})
