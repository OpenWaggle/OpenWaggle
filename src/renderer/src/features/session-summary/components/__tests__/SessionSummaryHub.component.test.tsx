import { SessionId, WorkingPath } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import type { SessionResource } from '@shared/types/session-resource'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import type { SessionResourceBrowserTarget } from '../../model/session-resource-browser'
import { useSessionSummaryUIStore } from '../../state/session-summary-ui-store'
import { SessionSummaryHub } from '../SessionSummaryHub'
import { SESSION_SUMMARY_SECTION_ORDER } from '../SessionSummaryPanelSections'

const listSessionResources = vi.hoisted(() => vi.fn())
const listArchivedSessions = vi.hoisted(() => vi.fn())
const listMcpEventSubscriptions = vi.hoisted(() => vi.fn())
const useStackedGitActions = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionResources,
    listArchivedSessions,
    listMcpEventSubscriptions,
    openExternal: vi.fn(),
  },
}))

vi.mock('@/features/git/hooks', () => ({
  useGit: () => ({
    workingPath: WorkingPath('/project'),
    repositoryPath: '/project',
    status: {
      branch: 'codex/session-summary-resource-hub',
      filesChanged: 2,
      additions: 12,
      deletions: 3,
      changedFiles: [],
    },
    refreshStatus: vi.fn(),
  }),
}))

vi.mock('@/features/git', () => ({
  CommitMessageDialog: () => null,
  resolveQuickAction: () => ({
    label: 'Commit & push',
    disabled: false,
    kind: 'run_action',
    action: 'commit_push',
  }),
  useStackedGitActions,
  useCombinedVcsStatus: () => ({
    status: {
      repositoryRoot: '/project',
      refName: 'codex/session-summary-resource-hub',
      defaultRef: 'main',
      hasUncommittedChanges: true,
      hasUpstream: true,
      aheadCount: 1,
      behindCount: 0,
      aheadOfDefaultCount: 1,
      sourceControlProvider: { id: 'github', label: 'GitHub' },
      changeRequest: null,
    },
    refresh: vi.fn(),
  }),
}))

function session(id = 'session-1'): SessionDetail {
  return {
    id: SessionId(id),
    title: `Session ${id}`,
    projectPath: '/project',
    messages: [],
    environmentMode: 'local',
    createdAt: 1000,
    updatedAt: 1000,
  }
}

function resource(overrides: Partial<SessionResource>): SessionResource {
  return {
    id: 'resource-1',
    sessionId: SessionId('session-1'),
    canonicalKey: 'sha256:image',
    kind: 'image',
    title: 'reference.png',
    mimeType: 'image/png',
    locator: 'session-resource://resource-1',
    available: true,
    isSource: true,
    isOutput: false,
    occurrences: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  }
}

type HubProps = {
  readonly activeSession?: SessionDetail | null
  readonly messageCount?: number
  readonly autoHidden?: boolean
  readonly rightSidebarOpen?: boolean
  readonly onOpenResources?: (target: SessionResourceBrowserTarget) => void
}

function hubElement(props: HubProps = {}, includeHeaderToggle = false) {
  return (
    <>
      {includeHeaderToggle ? (
        <Button
          id="session-summary-session-1-toggle"
          type="button"
          onClick={() => useSessionSummaryUIStore.getState().togglePanel('session-1')}
        >
          Session Summary toggle
        </Button>
      ) : null}
      <SessionSummaryHub
        key={props.activeSession?.id ?? 'none'}
        input={{
          session: props.activeSession === undefined ? session() : props.activeSession,
          messageCount: props.messageCount ?? 1,
          autoHidden: props.autoHidden ?? false,
          rightSidebarOpen: props.rightSidebarOpen ?? false,
          onOpenDiff: vi.fn(),
          onOpenResources: props.onOpenResources ?? vi.fn(),
          onNavigateSession: vi.fn(),
          extensionRegistry: null,
          extensionProjectPaths: ['/project'],
        }}
      />
    </>
  )
}

function renderHub(props: HubProps = {}, includeHeaderToggle = false) {
  return renderWithQueryClient(hubElement(props, includeHeaderToggle))
}

describe('SessionSummaryHub', () => {
  beforeEach(() => {
    localStorage.clear()
    useSessionSummaryUIStore.setState({ panels: {} })
    useUIStore.setState({ resourceViewer: null })
    listSessionResources.mockReset().mockResolvedValue([])
    listArchivedSessions.mockReset().mockResolvedValue([])
    listMcpEventSubscriptions.mockReset().mockResolvedValue([])
    useStackedGitActions.mockReset().mockReturnValue({ isRunning: false, run: vi.fn() })
  })

  it('keeps core and extension slots in the agreed deterministic order', () => {
    expect(SESSION_SUMMARY_SECTION_ORDER).toEqual([
      'subscriptions',
      'environment',
      'extensions-context',
      'hive',
      'extensions-coordination',
      'resource-catalog',
      'outputs',
      'sources',
      'extensions-details',
    ])
  })

  it('does not render before the opened session has its first message', () => {
    renderHub({ messageCount: 0 })
    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
  })

  it('appears after the first message with environment actions', async () => {
    renderHub()
    expect(screen.getByRole('complementary', { name: 'Session Summary' })).toBeInTheDocument()
    expect(screen.getByText('Environment')).toBeInTheDocument()
    expect(screen.getByText('Changes')).toBeInTheDocument()
    expect(screen.getByText('Create PR')).toBeInTheDocument()
    await waitFor(() => expect(listSessionResources).toHaveBeenCalledWith(SessionId('session-1')))
  })

  it('keeps a failed resource catalog visible and retryable in the Summary', async () => {
    listSessionResources
      .mockRejectedValueOnce(new Error('catalog unavailable'))
      .mockResolvedValue([])
    renderHub()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load session resources.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(listSessionResources).toHaveBeenCalledTimes(2))
  })

  it('keeps long summary content inside a bounded, scrollable surface', () => {
    renderHub()
    const summary = screen.getByRole('complementary', { name: 'Session Summary' })
    expect(summary).toHaveClass('max-h-full', 'max-w-full', 'overflow-hidden')
    expect(summary.parentElement).toHaveClass(
      'absolute',
      'right-4',
      'bottom-4',
      'left-4',
      'top-14',
      'items-start',
    )
    expect(summary.querySelector('.overflow-y-auto')).toBeInTheDocument()
  })

  it('lets the header state force the panel open when it is automatically hidden', () => {
    renderHub({ autoHidden: true })
    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()

    act(() => useSessionSummaryUIStore.getState().togglePanel('session-1'))

    expect(screen.getByRole('complementary', { name: 'Session Summary' })).toBeInTheDocument()
  })

  it('hard-hides the panel while a right sidebar is open', () => {
    renderHub({ rightSidebarOpen: true })

    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
  })

  it('restores focus to the header toggle when suppression hides the focused panel', async () => {
    const view = renderHub({}, true)
    const changes = screen.getByRole('button', { name: /Changes/ })
    changes.focus()
    expect(changes).toHaveFocus()

    view.rerender(
      <QueryClientProvider client={view.client}>
        {hubElement({ rightSidebarOpen: true }, true)}
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByText('Session Summary toggle')).toHaveFocus())
  })

  it('shows only resources returned for the opened session', async () => {
    listSessionResources.mockImplementation(async (sessionId: SessionId) =>
      sessionId === SessionId('session-2')
        ? [resource({ id: 'resource-2', sessionId, title: 'session-two.png' })]
        : [resource({ title: 'session-one.png' })],
    )

    const first = renderHub()
    fireEvent.click(await screen.findByRole('button', { name: /Sources/ }))
    expect(await screen.findByText('session-one.png')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show all' })).toBeInTheDocument()
    expect(screen.queryByText('session-two.png')).toBeNull()

    first.unmount()
    renderHub({ activeSession: session('session-2') })
    fireEvent.click(await screen.findByRole('button', { name: /Sources/ }))
    expect(await screen.findByText('session-two.png')).toBeInTheDocument()
    expect(screen.queryByText('session-one.png')).toBeNull()
  })

  it('opens a Summary image in the active session gallery', async () => {
    listSessionResources.mockResolvedValue([resource({ title: 'reference.png' })])
    renderHub()

    fireEvent.click(await screen.findByRole('button', { name: 'Sources 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'reference.png' }))

    expect(useUIStore.getState().resourceViewer).toEqual({
      sessionId: 'session-1',
      resourceId: 'resource-1',
    })
  })

  it('opens a non-image resource on its owning browser tab and selection', async () => {
    const onOpenResources = vi.fn()
    listSessionResources.mockResolvedValue([
      resource({
        kind: 'file',
        title: 'report.md',
        mimeType: 'text/markdown',
        isSource: false,
        isOutput: true,
      }),
    ])
    renderHub({ onOpenResources })

    fireEvent.click(await screen.findByRole('button', { name: 'Outputs 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'report.md' }))

    expect(onOpenResources).toHaveBeenCalledWith({ view: 'outputs', resourceId: 'resource-1' })
  })

  it('runs stacked actions against the session that owns the Summary', () => {
    renderHub({ activeSession: session('session-owner') })
    const options = useStackedGitActions.mock.calls.at(-1)?.[0]
    expect(options?.sessionId).toBe(SessionId('session-owner'))
  })

  it('persists collapsed state per session', () => {
    const first = renderHub({}, true)
    fireEvent.click(screen.getByRole('button', { name: 'Session Summary toggle' }))
    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
    expect(localStorage.getItem('openwaggle:session-summary:session-1:panel')).toBe('false')
    first.unmount()

    renderHub()
    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
  })
})
