import type { ActionCatalog } from '@shared/types/action-definitions'
import type {
  ActionManagementRequest,
  ActionManagementResult,
} from '@shared/types/action-management'
import type { ActionRun } from '@shared/types/action-runs'
import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { actionExecutionKey } from '@shared/utils/action-execution-key'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { openActionOutputTerminalView, useTerminalStore } from '@/features/terminal'
import {
  closeWorkspaceRightPanel,
  hasActiveWorkspaceRightPanel,
} from '@/shell/workspace-panel-actions'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { newActionDraft } from '../../lib/action-panel-drafts'
import { useActionPanelStore } from '../../state/action-panel-store'
import { useProjectActionStore } from '../../state/project-action-store'
import { actionCatalog, TEST_ACTION } from './native-action-fixtures'

/*
 * Only the preload and the router are replaced: the action queries, the run hook, the chat,
 * action panel, workspace panel and terminal stores are the real ones. The fake Host answers
 * each action-management operation from the catalog and runs below.
 */
const host = vi.hoisted(() => {
  // Declared property types are not narrowed, so a test can set a catalog, an error and runs.
  const initial: {
    readonly catalog: ActionCatalog | null
    readonly catalogError: Error | null
    readonly runs: ActionRun[]
  } = { catalog: null, catalogError: null, runs: [] }
  return { ...initial, manage: vi.fn(), navigate: vi.fn() }
})
vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi({
    manageProjectActions: host.manage,
  }),
}))
// Settings links target the app route tree, which a component test does not build.
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => host.navigate }))
// A spy on the real entry: the terminal feature keeps the views it opens private, so the view
// the surface asks for is read from this cross-feature call.
vi.mock('@/features/terminal', async (importOriginal) => {
  const terminal = await importOriginal<typeof import('@/features/terminal')>()
  return {
    ...terminal,
    openActionOutputTerminalView: vi.fn(terminal.openActionOutputTerminalView),
  }
})

import { ProjectActionsSurface } from '../ProjectActionsSurface'

/** The terminal owner key of the Session these cases use. */
const TERMINAL_OWNER = 'session'

const SESSION_ID = SessionId('session')

const DEV = {
  ...TEST_ACTION,
  id: 'dev',
  name: 'dev',
  icon: 'play' as const,
  kind: 'service' as const,
  invocation: { type: 'command' as const, command: 'pnpm dev', directory: '.' },
  shortcutRules: [{ shortcut: { key: 'd', mod: true, shift: true, alt: false } }],
}

function devRun(overrides: Partial<ActionRun> = {}) {
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
  } satisfies ActionRun
}

async function answer({ operation }: ActionManagementRequest) {
  const { type } = operation
  if (type === 'catalog') {
    if (host.catalogError) throw host.catalogError
    // No catalog yet: the read stays in flight.
    const result: ActionManagementResult | Promise<never> = host.catalog
      ? { type, catalog: host.catalog }
      : new Promise<never>(() => {})
    return result
  }
  if (type === 'runs') return { type, runs: host.runs }
  if (type === 'discover') return { type: 'discovery', discovery: { tasks: [], diagnostics: [] } }
  if (type === 'start') return { type: 'run', run: devRun({ id: 'started' }) }
  if (type === 'stop') return { type: 'run', run: devRun({ status: 'stopped' }) }
  throw new Error(`Unexpected operation ${type}`)
}

const onShowRunOutput = vi.fn()

function renderSurface(props: { projectPath?: string | null; inSession?: boolean } = {}) {
  useChatStore.setState({
    activeSession:
      props.inSession === false
        ? null
        : fromPartial<SessionDetail>({ id: SESSION_ID, projectPath: '/repo' }),
  })
  return renderWithQueryClient(
    <ProjectActionsSurface
      projectPath={props.projectPath === undefined ? '/repo' : props.projectPath}
      onShowRunOutput={onShowRunOutput}
    />,
  )
}

/** The surface once the catalog and, in a Session, its runs were read. */
async function renderLoadedSurface() {
  const view = renderSurface()
  await screen.findByRole('list', { name: 'Saved actions' })
  await waitFor(() =>
    expect(host.manage).toHaveBeenCalledWith(
      expect.objectContaining({ operation: { type: 'runs' } }),
    ),
  )
  return view
}

const initialChat = useChatStore.getInitialState()
const initialActionPanel = useActionPanelStore.getInitialState()
const initialProjectActions = useProjectActionStore.getInitialState()
const initialTerminal = useTerminalStore.getInitialState()

describe('ProjectActionsSurface', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    host.catalog = {
      ...actionCatalog(),
      actions: [
        { source: 'local', definition: TEST_ACTION },
        { source: 'project', definition: DEV },
      ],
    }
    host.catalogError = null
    host.runs = []
    host.manage.mockImplementation(answer)
    useActionPanelStore.setState({ request: null, drafts: {} })
  })

  afterEach(() => {
    useChatStore.setState(initialChat, true)
    useActionPanelStore.setState(initialActionPanel, true)
    useProjectActionStore.setState(initialProjectActions, true)
    useTerminalStore.setState(initialTerminal, true)
    closeWorkspaceRightPanel('session')
    useUIStore.getState().clearToast()
    localStorage.clear()
  })

  it('lists every action as a panel row with its command, shortcut and Run', async () => {
    await renderLoadedSurface()
    expect(screen.getByText('Run in this session’s workspace')).toBeVisible()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    const rows = within(screen.getByRole('list', { name: 'Saved actions' })).getAllByRole(
      'listitem',
    )
    expect(rows).toHaveLength(2)
    expect(within(rows[1] ?? document.body).getByText('pnpm dev')).toBeVisible()
    expect(rows[1]?.querySelector('kbd')?.textContent).toMatch(/Shift/)

    fireEvent.click(screen.getByRole('button', { name: 'Run dev' }))

    // The run starts in the Session and its output opens in the workspace panel.
    await waitFor(() => expect(hasActiveWorkspaceRightPanel('session')).toBe(true))
    expect(useProjectActionStore.getState().lastInvokedByProject).toEqual({ '/repo': 'dev' })
    expect(host.manage).toHaveBeenCalledWith({
      scope: { projectPath: '/repo', sessionId: SESSION_ID },
      operation: expect.objectContaining({
        type: 'start',
        actionId: 'dev',
        expectedExecutionKey: actionExecutionKey(DEV),
      }),
    })
  })

  it('shows a running action with Stop, Restart, Show output and Open in terminal', async () => {
    host.runs = [devRun({ id: 'old', status: 'completed', startedAt: 1 }), devRun()]
    renderSurface()
    const stop = await screen.findByRole('button', { name: 'Stop dev' })
    const row = stop.closest('li')
    expect(row).not.toBeNull()
    expect(within(row ?? document.body).getByText('Running')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Run dev' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restart dev' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Show output for dev' }))
    expect(onShowRunOutput).toHaveBeenCalledWith({ projectPath: '/repo', runId: 'run-1' })

    fireEvent.click(screen.getByRole('button', { name: 'Open dev output in terminal' }))
    expect(openActionOutputTerminalView).toHaveBeenCalledWith({
      ownerKey: 'session',
      projectPath: '/repo',
      actionId: 'dev',
      runId: 'run-1',
      label: 'dev',
    })
    expect(useTerminalStore.getState().groups[TERMINAL_OWNER]?.panelOpen).toBe(true)

    fireEvent.click(stop)
    await waitFor(() =>
      expect(host.manage).toHaveBeenCalledWith({
        scope: { projectPath: '/repo', sessionId: SESSION_ID },
        operation: { type: 'stop', runId: 'run-1' },
      }),
    )
  })

  it('says why the Host refused to stop a run, and keeps the row', async () => {
    host.runs = [devRun()]
    host.manage.mockImplementation(async (request: ActionManagementRequest) => {
      if (request.operation.type === 'stop') throw new Error('The run already ended.')
      return answer(request)
    })
    renderSurface()

    fireEvent.click(await screen.findByRole('button', { name: 'Stop dev' }))

    await waitFor(() =>
      expect(useUIStore.getState().toastData).toMatchObject({
        message: 'The run already ended.',
      }),
    )
    expect(screen.getByRole('button', { name: 'Stop dev' })).toBeEnabled()
  })

  it('offers Run again and the retained output once a run ended', async () => {
    host.runs = [devRun({ status: 'failed', exitCode: 1 })]
    renderSurface()
    expect(await screen.findByText('Failed')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Run dev' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Show output for dev' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Stop dev' })).not.toBeInTheDocument()
  })

  it('opens Add action and continues an unfinished draft in the guided panel', async () => {
    await renderLoadedSurface()
    expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    expect(useActionPanelStore.getState().request).toEqual({
      kind: 'action',
      scope: { projectPath: '/repo', sessionId: SESSION_ID },
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

  it.each([
    {
      state: 'empty',
      arrange: () => {
        host.catalog = { ...actionCatalog(), actions: [] }
      },
      shows: 'No saved actions yet. Add one to run it here.',
      canAdd: true,
    },
    {
      state: 'loading',
      arrange: () => {
        host.catalog = null
      },
      shows: 'Loading actions…',
      canAdd: false,
    },
  ])('shows the $state state', async ({ arrange, shows, canAdd }) => {
    arrange()
    renderSurface()

    expect(await screen.findByText(shows)).toBeVisible()
    if (canAdd) expect(screen.getByRole('button', { name: 'Add action' })).toBeEnabled()
    else expect(screen.getByRole('button', { name: 'Add action' })).toBeDisabled()
  })

  it('shows why the catalog could not be read', async () => {
    host.catalogError = new Error('Could not read actions.json')
    renderSurface()

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read actions.json')
  })

  it('asks for a project first', () => {
    renderSurface({ projectPath: null })

    expect(screen.getByText('Open a project first to run its actions.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Add action' })).not.toBeInTheDocument()
  })

  it('asks for a session in this project before running', async () => {
    renderSurface({ inSession: false })

    expect(screen.getByText('Select a session in this project to run actions.')).toBeVisible()
    expect(await screen.findByRole('button', { name: 'Run dev' })).toBeDisabled()
    expect(host.manage).not.toHaveBeenCalledWith(
      expect.objectContaining({ operation: { type: 'runs' } }),
    )
  })
})
