import type { UsageCostSessionRow, UsageCostView } from '@shared/types/usage-cost'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UsageCostPage, type UsageCostPageState } from '../UsageCostPage'

const VIEW: UsageCostView = {
  query: { preset: '30d', origin: 'all' },
  generatedAtMs: Date.parse('2026-10-14T12:00:00Z'),
  rangeStartMs: Date.parse('2026-09-14T12:00:00Z'),
  rangeEndMs: Date.parse('2026-10-14T12:00:00Z'),
  totals: {
    tokens: { input: 100, output: 200, cacheRead: 300, cacheWrite: 0, total: 600 },
    recordedCostUsd: 1.25,
    estimatedCostUsd: 0.5,
    unpricedTokens: 100,
  },
  unpricedShare: 100 / 600,
  days: [
    {
      day: '2026-10-13',
      tokens: { input: 40, output: 80, cacheRead: 100, cacheWrite: 0, total: 220 },
      recordedCostUsd: 0.25,
      estimatedCostUsd: 0,
      unpricedTokens: 0,
    },
    {
      day: '2026-10-14',
      tokens: { input: 60, output: 120, cacheRead: 200, cacheWrite: 0, total: 380 },
      recordedCostUsd: 1,
      estimatedCostUsd: 0.5,
      unpricedTokens: 100,
    },
  ],
  models: [
    {
      provider: 'anthropic',
      modelId: 'claude-opus-5-5',
      tokens: { input: 50, output: 100, cacheRead: 150, cacheWrite: 0, total: 300 },
      recordedCostUsd: 1,
      estimatedCostUsd: 0,
      unpricedTokens: 0,
    },
    {
      provider: 'pi',
      modelId: 'tools/summaries',
      tokens: { input: 50, output: 100, cacheRead: 150, cacheWrite: 0, total: 300 },
      recordedCostUsd: 0.25,
      estimatedCostUsd: 0.5,
      unpricedTokens: 100,
    },
  ],
  projects: [
    {
      projectPath: '/Users/dev/Projects/alpha',
      label: 'Alpha',
      detail: '~/Projects/alpha',
      tokens: { input: 100, output: 200, cacheRead: 300, cacheWrite: 0, total: 600 },
      recordedCostUsd: 1.25,
      estimatedCostUsd: 0.5,
      unpricedTokens: 100,
    },
  ],
  sessionCount: 2,
  scannedFiles: 5,
  scannedFilesCached: 3,
  scanDurationMs: 42,
}

const SESSIONS: readonly UsageCostSessionRow[] = [
  {
    sessionId: 'session-1',
    file: '/sessions/a.jsonl',
    projectLabel: 'Alpha',
    displayCwd: '~/Projects/alpha',
    origin: 'openwaggle',
    startedAtMs: Date.parse('2026-10-14T08:00:00Z'),
    lastActivityMs: Date.parse('2026-10-14T09:00:00Z'),
    tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 },
    recordedCostUsd: 0.1,
    estimatedCostUsd: 0,
    unpricedTokens: 0,
  },
]

function baseState(overrides: Partial<UsageCostPageState> = {}): UsageCostPageState {
  return {
    query: { preset: '30d', origin: 'all' },
    drillDown: {},
    isLoading: false,
    isError: false,
    errorMessage: null,
    sessionsLoading: false,
    view: VIEW,
    sessions: SESSIONS,
    refresh: vi.fn(),
    setRange: vi.fn(),
    setOrigin: vi.fn(),
    toggleDay: vi.fn(),
    toggleModel: vi.fn(),
    toggleProject: vi.fn(),
    clearDrillDown: vi.fn(),
    ...overrides,
  }
}

describe('UsageCostPage', () => {
  it('renders summary cards, the daily chart, and both breakdowns', () => {
    render(<UsageCostPage onBack={vi.fn()} state={baseState()} />)

    expect(screen.getByText('Estimated spend')).toBeInTheDocument()
    expect(screen.getByText('$1.75')).toBeInTheDocument()
    expect(screen.getByText('Daily spending')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /claude-opus-5-5/ })).toBeInTheDocument()
    // The label renders in the project row and the session row; the raw
    // absolute path never renders.
    expect(screen.getAllByText('Alpha')).toHaveLength(2)
    expect(screen.queryByText('/Users/dev/Projects/alpha')).toBeNull()
    expect(screen.getByRole('button', { name: /tools\/summaries/ })).toBeInTheDocument()
  })

  it('shows the unpriced-tokens notice when a share has no price', () => {
    render(<UsageCostPage onBack={vi.fn()} state={baseState()} />)
    expect(screen.getByText(/no recorded price and are excluded from cost/i)).toBeInTheDocument()
  })

  it('does not show the unpriced notice when everything is priced', () => {
    const state = baseState({
      view: {
        ...VIEW,
        totals: { ...VIEW.totals, unpricedTokens: 0 },
        unpricedShare: 0,
        models: VIEW.models.map((model) => ({ ...model, unpricedTokens: 0 })),
      },
    })
    render(<UsageCostPage onBack={vi.fn()} state={state} />)
    expect(screen.queryByText(/no recorded price and are excluded/i)).toBeNull()
  })

  it('drills into a model row and reports the selection in the sessions panel', () => {
    const toggleModel = vi.fn()
    const state = baseState({
      drillDown: { provider: 'anthropic', modelId: 'claude-opus-5-5' },
      toggleModel,
    })
    render(<UsageCostPage onBack={vi.fn()} state={state} />)

    fireEvent.click(screen.getByRole('button', { name: /claude-opus-5-5/ }))
    expect(toggleModel).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'anthropic', modelId: 'claude-opus-5-5' }),
    )

    expect(screen.getByText('Sessions in selection')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /clear selection/i }))
    expect(state.clearDrillDown).toHaveBeenCalled()
  })

  it('shows an empty state and no chart when nothing was scanned in range', () => {
    const state = baseState({
      view: {
        ...VIEW,
        totals: {
          ...VIEW.totals,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        days: [],
        models: [],
        projects: [],
        sessionCount: 0,
      },
      sessions: [],
    })
    render(<UsageCostPage onBack={vi.fn()} state={state} />)

    expect(screen.getByText('No spending in this window')).toBeInTheDocument()
    expect(screen.queryByText('Daily spending')).toBeNull()
  })

  it('surfaces a retryable error state', () => {
    const refresh = vi.fn()
    render(
      <UsageCostPage
        onBack={vi.fn()}
        state={baseState({ isError: true, errorMessage: 'Scan failed.', refresh })}
      />,
    )

    expect(screen.getByText('Usage & Cost is unavailable')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refresh).toHaveBeenCalled()
  })

  it('offers a way back to the app in every state', () => {
    const onBack = vi.fn()
    const { rerender } = render(<UsageCostPage onBack={onBack} state={baseState({ view: null })} />)
    expect(screen.getByText('Scanning Pi sessions…')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /back to app/i }))

    rerender(<UsageCostPage onBack={onBack} state={baseState({ isError: true })} />)
    fireEvent.click(screen.getByRole('button', { name: /back to app/i }))

    rerender(<UsageCostPage onBack={onBack} state={baseState()} />)
    fireEvent.click(screen.getByRole('button', { name: /back to app/i }))

    expect(onBack).toHaveBeenCalledTimes(3)
  })
})
