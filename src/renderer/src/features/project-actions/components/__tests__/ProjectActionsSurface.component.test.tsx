import type { ActionCatalog } from '@shared/types/action-definitions'
import type { ActionRun } from '@shared/types/action-runs'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { newActionDraft } from '../../lib/action-panel-drafts'
import { useActionPanelStore } from '../../state/action-panel-store'
import { actionCatalog, TEST_ACTION } from './native-action-fixtures'

const mocks = vi.hoisted(() => ({
  catalog: ((): ActionCatalog | null => null)(),
  catalogError: ((): Error | null => null)(),
  runs: ((): ActionRun[] => [])(),
  run: vi.fn(),
  manage: vi.fn(),
  openView: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
  scopeSessionId: ((): string | null => 'session')(),
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/shared/lib/ipc', () => ({ api: { manageProjectActions: mocks.manage } }))
vi.mock('@/features/terminal', () => ({ openActionOutputTerminalView: mocks.openView }))
vi.mock('../../hooks/useNativeActions', () => ({
  actionQueryKey: () => ['native-actions', '/repo', 'session'],
  useNativeActions: () => ({ data: mocks.catalog ?? undefined, error: mocks.catalogError }),
  useActionRuns: () => ({ data: mocks.runs }),
  useActionDiscovery: () => ({ data: undefined }),
  useActionScope: (projectPath: string | null) =>
    projectPath
      ? { projectPath, ...(mocks.scopeSessionId ? { sessionId: mocks.scopeSessionId } : {}) }
      : null,
}))
vi.mock('../../hooks/useRunProjectAction', () => ({ useRunProjectAction: () => mocks.run }))

import { ProjectActionsSurface } from '../ProjectActionsSurface'

const DEV = {
  ...TEST_ACTION,
  id: 'dev',
  name: 'dev',
  icon: 'play' as const,
  kind: 'service' as const,
  invocation: { type: 'command' as const, command: 'pnpm dev', directory: '.' },
  shortcutRules: [{ shortcut: { key: 'd', mod: true, shift: true, alt: false } }],
}

function devRun(overrides: Partial<ActionRun> = {}): ActionRun {
  return {
    id: 'run-1',
    requestId: 'request',
    workspaceId: 'workspace',
    projectPath: '/repo',
    workspacePath: '/repo',
    action: DEV,
    invocation: { type: 'command', command: 'pnpm dev', cwd: '/repo' },
    status: 'running',
    startedAt: 10,
    finishedAt: null,
    exitCode: null,
    error: null,
    previewUrl: null,
    ready: false,
    outputBytes: 12,
    ...overrides,
  }
}

const onShowRunOutput = vi.fn()

function renderSurface(props: { projectPath?: string | null; sessionId?: string | null } = {}) {
  mocks.scopeSessionId = props.sessionId === undefined ? 'session' : props.sessionId
  return renderWithQueryClient(
    <ProjectActionsSurface
      projectPath={props.projectPath === undefined ? '/repo' : props.projectPath}
      onShowRunOutput={onShowRunOutput}
    />,
  )
}

describe('ProjectActionsSurface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.catalog = {
      ...actionCatalog(),
      actions: [
        { source: 'local', definition: TEST_ACTION },
        { source: 'project', definition: DEV },
      ],
    }
    mocks.catalogError = null
    mocks.runs = []
    mocks.run.mockResolvedValue(true)
    mocks.manage.mockResolvedValue({ type: 'run', run: devRun({ status: 'stopped' }) })
    mocks.openView.mockReturnValue(true)
    useUIStore.setState({ showToast: mocks.toast })
    useActionPanelStore.setState({ request: null, drafts: {} })
  })

  it('lists every action as a panel row with its command, shortcut and Run', () => {
    renderSurface()
    expect(screen.getByText('Run in this session’s workspace')).toBeVisible()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    const rows = within(screen.getByRole('list', { name: 'Saved actions' })).getAllByRole(
      'listitem',
    )
    expect(rows).toHaveLength(2)
    expect(within(rows[1] ?? document.body).getByText('pnpm dev')).toBeVisible()
    expect(rows[1]?.querySelector('kbd')?.textContent).toMatch(/Shift/)
    fireEvent.click(screen.getByRole('button', { name: 'Run dev' }))
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith(DEV)
  })

  it('shows a running action with Stop, Restart, Show output and Open in terminal', async () => {
    mocks.runs = [devRun({ id: 'old', status: 'completed', startedAt: 1 }), devRun()]
    renderSurface()
    const row = screen.getByRole('button', { name: 'Stop dev' }).closest('li')
    expect(row).not.toBeNull()
    expect(within(row ?? document.body).getByText('Running')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Run dev' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restart dev' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Show output for dev' }))
    expect(onShowRunOutput).toHaveBeenCalledWith({ projectPath: '/repo', runId: 'run-1' })

    fireEvent.click(screen.getByRole('button', { name: 'Open dev output in terminal' }))
    expect(mocks.openView).toHaveBeenCalledWith({
      ownerKey: 'session',
      projectPath: '/repo',
      actionId: 'dev',
      runId: 'run-1',
      label: 'dev',
    })

    fireEvent.click(screen.getByRole('button', { name: 'Stop dev' }))
    await waitFor(() =>
      expect(mocks.manage).toHaveBeenCalledWith({
        scope: { projectPath: '/repo', sessionId: 'session' },
        operation: { type: 'stop', runId: 'run-1' },
      }),
    )
  })

  it('offers Run again and the retained output once a run ended', () => {
    mocks.runs = [devRun({ status: 'failed', exitCode: 1 })]
    renderSurface()
    expect(screen.getByRole('button', { name: 'Run dev' })).toBeEnabled()
    expect(screen.getByText('Failed')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Show output for dev' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Stop dev' })).not.toBeInTheDocument()
  })

  it('opens Add action and continues an unfinished draft in the guided panel', () => {
    renderSurface()
    expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    expect(useActionPanelStore.getState().request).toEqual({
      kind: 'action',
      scope: { projectPath: '/repo', sessionId: 'session' },
      actionId: null,
      origin: 'session',
    })
    const draft = newActionDraft(false)
    act(() => {
      useActionPanelStore.setState({
        request: null,
        drafts: { '/repo': { ...draft, definition: { ...draft.definition, name: 'Half done' } } },
      })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue new action' }))
    expect(useActionPanelStore.getState().request).toMatchObject({ kind: 'action', actionId: null })
  })

  it('shows the empty, loading and error states', () => {
    mocks.catalog = { ...actionCatalog(), actions: [] }
    const { unmount } = renderSurface()
    expect(screen.getByText('No saved actions yet. Add one to run it here.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add action' })).toBeEnabled()
    unmount()

    mocks.catalog = null
    const loading = renderSurface()
    expect(screen.getByText('Loading actions…')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add action' })).toBeDisabled()
    loading.unmount()

    mocks.catalogError = new Error('Could not read actions.json')
    renderSurface()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not read actions.json')
  })

  it('asks for a project first, and for a session before running', () => {
    const { unmount } = renderSurface({ projectPath: null })
    expect(screen.getByText('Open a project first to run its actions.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Add action' })).not.toBeInTheDocument()
    unmount()

    renderSurface({ sessionId: null })
    expect(screen.getByText('Select a session in this project to run actions.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Run dev' })).toBeDisabled()
  })
})
