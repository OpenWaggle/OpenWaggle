import { SessionId, WorkingPath } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import type { SessionResource } from '@shared/types/session-resource'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { SessionSummaryHub } from '../SessionSummaryHub'

const listSessionResources = vi.hoisted(() => vi.fn())
const listArchivedSessions = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listSessionResources,
    listArchivedSessions,
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
  useStackedGitActions: () => ({ isRunning: false, run: vi.fn() }),
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

function renderHub(
  props: {
    readonly activeSession?: SessionDetail | null
    readonly messageCount?: number
    readonly autoHidden?: boolean
    readonly rightSidebarOpen?: boolean
  } = {},
) {
  return renderWithQueryClient(
    <SessionSummaryHub
      key={props.activeSession?.id ?? 'none'}
      input={{
        session: props.activeSession === undefined ? session() : props.activeSession,
        messageCount: props.messageCount ?? 1,
        autoHidden: props.autoHidden ?? false,
        rightSidebarOpen: props.rightSidebarOpen ?? false,
        onOpenDiff: vi.fn(),
        onOpenResources: vi.fn(),
        onNavigateSession: vi.fn(),
        extensionRegistry: null,
        extensionProjectPaths: ['/project'],
      }}
    />,
  )
}

describe('SessionSummaryHub', () => {
  beforeEach(() => {
    localStorage.clear()
    listSessionResources.mockReset().mockResolvedValue([])
    listArchivedSessions.mockReset().mockResolvedValue([])
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

  it('keeps the Summary toggle available when the panel is automatically hidden', () => {
    renderHub({ autoHidden: true })
    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
    const toggle = screen.getByRole('button', { name: 'Open Session Summary' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)

    expect(screen.getByRole('complementary', { name: 'Session Summary' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide Session Summary' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('keeps the toggle but hard-hides the panel while a right sidebar is open', () => {
    renderHub({ rightSidebarOpen: true })

    expect(screen.queryByRole('complementary', { name: 'Session Summary' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open Session Summary' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
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
    expect(screen.queryByText('session-two.png')).toBeNull()

    first.unmount()
    renderHub({ activeSession: session('session-2') })
    fireEvent.click(await screen.findByRole('button', { name: /Sources/ }))
    expect(await screen.findByText('session-two.png')).toBeInTheDocument()
    expect(screen.queryByText('session-one.png')).toBeNull()
  })

  it('persists collapsed state per session', () => {
    const first = renderHub()
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Session Summary' }))
    expect(screen.getByRole('button', { name: 'Open Session Summary' })).toBeInTheDocument()
    first.unmount()

    renderHub()
    expect(screen.getByRole('button', { name: 'Open Session Summary' })).toBeInTheDocument()
  })
})
