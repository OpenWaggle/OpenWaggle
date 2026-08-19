import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { useProviderStore } from '@/features/providers/state'
import { useSessionStatusStore, useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { useUIStore } from '@/shell/ui-store'
import { usePinnedSessionsStore } from '../../state/pinned-sessions-store'
import { useSidebarFilterStore } from '../../state/sidebar-filter-store'
import { useSidebarViewStore } from '../../state/sidebar-view-store'
import { Sidebar } from '../Sidebar'

const { navigateMock, routerState } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  routerState: { pathname: '/' },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useRouterState: (options: {
    readonly select: (state: { readonly location: { readonly pathname: string } }) => string
  }) => options.select({ location: { pathname: routerState.pathname } }),
}))

vi.mock('@/shell/useFullscreen', () => ({ useFullscreen: () => false }))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getGitStatus: vi.fn(),
    onGitWorkingTreeChanged: () => () => {},
    listPinnedSessions: vi.fn(async () => []),
    openPath: vi.fn(),
    showConfirm: vi.fn(),
    updateSettings: vi.fn(),
  },
}))

const ALPHA = '/repo/alpha'
const BETA = '/repo/beta'

const WORKING_ID = SessionId('session-working')
const ERROR_ID = SessionId('session-error')
const INPUT_ID = SessionId('session-input')
const IDLE_ID = SessionId('session-idle')
const BETA_ERROR_ID = SessionId('session-beta-error')

function session(id: SessionId, title: string, projectPath: string, updatedAt: number) {
  return { id, title, projectPath, createdAt: 1, updatedAt } satisfies SessionSummary
}

function makeSessions(): SessionSummary[] {
  return [
    session(WORKING_ID, 'Working session', ALPHA, 50),
    session(ERROR_ID, 'Failed session', ALPHA, 40),
    session(INPUT_ID, 'Question session', ALPHA, 30),
    session(IDLE_ID, 'Quiet session', ALPHA, 20),
    session(BETA_ERROR_ID, 'Other project failure', BETA, 10),
  ]
}

/** Statuses spread across two projects, so a filter has to reach beyond one group. */
function seedStatuses() {
  useSessionStatusStore.setState({
    statuses: new Map([
      [WORKING_ID, 'working'],
      [ERROR_ID, 'error'],
      [INPUT_ID, 'awaiting-input'],
      [BETA_ERROR_ID, 'error'],
    ]),
    completedAt: new Map(),
    lastVisitedAt: new Map(),
    phases: new Map([[WORKING_ID, 'Refactoring']]),
  })
}

function resetStores() {
  const sessions = makeSessions()
  usePreferencesStore.setState({
    ...usePreferencesStore.getInitialState(),
    settings: {
      ...DEFAULT_SETTINGS,
      projectPath: ALPHA,
      selectedModel: SupportedModelId('openai/gpt-5'),
      recentProjects: [ALPHA, BETA],
    },
    isLoaded: true,
  })
  useProviderStore.setState({
    ...useProviderStore.getInitialState(),
    baseProviderModels: [],
    providerModels: [],
  })
  useChatStore.setState({
    sessions,
    sessionById: new Map(),
    missingSessionIds: new Set(),
    draftSession: null,
    activeSessionId: null,
    activeSession: null,
    error: null,
  })
  useSessionStore.setState({
    ...useSessionStore.getInitialState(),
    sessions,
    activeSessionTree: null,
    activeWorkspace: null,
    draftBranch: null,
  })
  useSessionStatusStore.setState({
    statuses: new Map(),
    completedAt: new Map(),
    lastVisitedAt: new Map(),
    phases: new Map(),
  })
  useUIStore.setState({ ...useUIStore.getInitialState(), sidebarOpen: true })
  usePinnedSessionsStore.setState({ pins: [], sortMode: 'manual' })
  useSidebarFilterStore.setState({ activeState: null })
  useSidebarViewStore.setState({ sessionSortMode: 'recent', projectExpandedByPath: {} })
}

/**
 * QA hooks are `data-qa`, shared with the prototype-diff harness, so a selector proven in one
 * place works in the other. Testing Library's default attribute is left alone because other
 * suites rely on `data-testid` from their mocks.
 */
const qa = (name: string) => [...document.querySelectorAll(`[data-qa="${name}"]`)]

const chipGroup = () => screen.getByRole('group', { name: 'Filter sessions by state' })
const chipNames = () =>
  within(chipGroup())
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'))
const rowTitles = () => qa('sidebar-session-row').map((row) => row.textContent ?? '')

describe('Sidebar status chips and project pips', () => {
  beforeEach(() => {
    resetStores()
  })

  /**
   * A chip is a summary of what is happening, not a fixed toolbar. Idle is excluded because a
   * count of "nothing is happening" would be the largest number in the sidebar and the least
   * useful, and it cannot be acted on.
   */
  it('shows a chip only for states that are present, and never for idle', () => {
    seedStatuses()
    render(<Sidebar />)

    expect(chipNames()).toEqual([
      'Show only: Needs your input, 1',
      'Show only: Run failed, 2',
      'Show only: Working, 1',
    ])
    expect(chipNames().some((label) => label?.includes('Idle'))).toBe(false)
  })

  it('renders no chip group at all when every session is idle', () => {
    render(<Sidebar />)

    expect(
      screen.queryByRole('group', { name: 'Filter sessions by state' }),
    ).not.toBeInTheDocument()
  })

  /** Counts are ranked, so the state that needs a human is reachable first. */
  it('orders chips by how much they need a person', () => {
    seedStatuses()
    render(<Sidebar />)

    expect(chipNames()).toEqual([
      'Show only: Needs your input, 1',
      'Show only: Run failed, 2',
      'Show only: Working, 1',
    ])
  })

  /**
   * The point of the chips: one click isolates a state wherever it lives, including in projects
   * the user has not expanded.
   */
  it('filters across every project, not just the current one', () => {
    seedStatuses()
    render(<Sidebar />)

    fireEvent.click(within(chipGroup()).getByRole('button', { name: 'Show only: Run failed, 2' }))

    const titles = rowTitles()
    expect(titles.some((text) => text.includes('Failed session'))).toBe(true)
    expect(titles.some((text) => text.includes('Other project failure'))).toBe(true)
    expect(titles.some((text) => text.includes('Working session'))).toBe(false)
    expect(titles.some((text) => text.includes('Quiet session'))).toBe(false)
  })

  it('keeps every chip visible while one is active, so another state is one click away', () => {
    seedStatuses()
    render(<Sidebar />)

    fireEvent.click(within(chipGroup()).getByRole('button', { name: 'Show only: Run failed, 2' }))

    expect(chipNames()).toEqual([
      'Show only: Needs your input, 1',
      'Clear filter: Run failed, 2',
      'Show only: Working, 1',
    ])
  })

  it('reports the active chip as pressed', () => {
    seedStatuses()
    render(<Sidebar />)

    const chip = within(chipGroup()).getByRole('button', { name: 'Show only: Working, 1' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(chip)

    expect(
      within(chipGroup()).getByRole('button', { name: 'Clear filter: Working, 1' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('clicking the active chip clears the filter', () => {
    seedStatuses()
    render(<Sidebar />)

    fireEvent.click(within(chipGroup()).getByRole('button', { name: 'Show only: Working, 1' }))
    fireEvent.click(within(chipGroup()).getByRole('button', { name: 'Clear filter: Working, 1' }))

    expect(useSidebarFilterStore.getState().activeState).toBeNull()
    expect(rowTitles().some((text) => text.includes('Quiet session'))).toBe(true)
  })

  /**
   * A filter subtracts sessions, so one left over from days ago would open the app on a nearly
   * empty list with no memory of why. Sorting and collapsing rearrange and do persist.
   */
  it('starts unfiltered on launch', () => {
    expect(useSidebarFilterStore.getState().activeState).toBeNull()
  })

  /**
   * A project heading answers "is there anything in here for me" without being expanded, which
   * is the whole point of collapsing one.
   */
  it('shows roll-up pips with counts and accessible names', () => {
    seedStatuses()
    render(<Sidebar />)

    const pips = qa('sidebar-pip')
    const labels = pips.map((pip) => pip.getAttribute('aria-label'))

    expect(labels).toContain('Needs your input: 1')
    expect(labels).toContain('Run failed: 1')
    expect(labels).toContain('Working: 1')
  })

  it('pairs every pip colour with a count, so colour is never the only cue', () => {
    seedStatuses()
    render(<Sidebar />)

    for (const pip of qa('sidebar-pip')) {
      expect(pip.textContent?.trim()).toMatch(/^\d+$/)
      expect(pip.getAttribute('aria-label')).toBeTruthy()
    }
  })

  /**
   * Restricted to the loud and in-flight tiers. A heading reporting finished or idle sessions
   * does not answer the question the heading exists to answer.
   */
  it('leaves quiet states out of the roll-up', () => {
    useSessionStatusStore.setState({
      statuses: new Map([[IDLE_ID, 'completed']]),
      completedAt: new Map([[IDLE_ID, 5]]),
      lastVisitedAt: new Map(),
      phases: new Map(),
    })
    render(<Sidebar />)

    expect(qa('sidebar-pip')).toHaveLength(0)
  })

  it('falls back to a session count when a project has nothing to report', () => {
    render(<Sidebar />)

    const counts = qa('sidebar-project-count').map((el) => el.textContent)
    expect(counts).toContain('4')
  })

  /** The agent's phase, kept from the event that used to discard it. */
  it('names what the agent is doing on an in-flight row', () => {
    seedStatuses()
    render(<Sidebar />)

    const working = qa('sidebar-session-row').find((row) =>
      row.textContent?.includes('Working session'),
    )

    expect(working?.textContent).toContain('Refactoring')
  })

  it('names the state in words next to its colour', () => {
    seedStatuses()
    render(<Sidebar />)

    const labels = qa('sidebar-row-state').map((el) => el.textContent)
    expect(labels).toContain('Working')
    expect(labels).toContain('Error')
    expect(labels).toContain('Input')
  })
})
