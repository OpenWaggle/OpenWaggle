import type { ActionCatalog, ProjectTaskDiscovery } from '@shared/types/action-definitions'
import type {
  ActionManagementRequest,
  ActionManagementResult,
} from '@shared/types/action-management'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings/state'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { useActionPanelStore } from '../../state/action-panel-store'
import { ActionPanel } from '../action-panel/ActionPanel'
import { actionCatalog, TEST_ACTION, TEST_TASK } from './native-action-fixtures'

const mocks = vi.hoisted(() => ({
  manage: vi.fn<(request: ActionManagementRequest) => Promise<ActionManagementResult>>(),
  navigate: vi.fn(),
  projectPath: ((): string | null => '/repo')(),
  selectFolder: vi.fn(),
  projectPage: vi.fn(async () => ({ paths: [], nextCursor: null })),
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/features/sessions/hooks', () => ({
  useProject: () => ({ projectPath: mocks.projectPath, selectFolder: mocks.selectFolder }),
  useSessionProjectPath: () => mocks.projectPath,
}))
vi.mock('@/features/chat/hooks', () => ({
  useChat: () => ({ activeSession: { id: 'session', projectPath: '/repo' } }),
}))
vi.mock('@/shared/lib/ipc', () => ({
  api: { manageProjectActions: mocks.manage, listSessionProjectPage: mocks.projectPage },
}))

import { ProjectActionsSettings } from '../ProjectActionsSettings'

/** The shell docks the panel; these tests render its content beside Settings. */
function PanelHost() {
  const request = useActionPanelStore((state) => state.request)
  return request ? <ActionPanel request={request} /> : null
}

function renderSettings() {
  return renderWithQueryClient(
    <>
      <ProjectActionsSettings />
      <PanelHost />
    </>,
  )
}

let discovery: ProjectTaskDiscovery | Error = { tasks: [TEST_TASK], diagnostics: [] }
function serve(catalog: ActionCatalog) {
  mocks.manage.mockImplementation(async ({ operation }) => {
    if (operation.type === 'catalog' || operation.type === 'edit')
      return { type: 'catalog', catalog }
    if (operation.type === 'runs') return { type: 'runs', runs: [] }
    if (operation.type === 'discover') {
      if (discovery instanceof Error) throw discovery
      return { type: 'discovery', discovery }
    }
    throw new Error(`Unexpected operation ${operation.type}`)
  })
}
function savedEdits() {
  return mocks.manage.mock.calls.flatMap(([request]) =>
    request.operation.type === 'edit' ? [request.operation] : [],
  )
}
const panel = () => screen.findByTestId('action-panel')

describe('native action settings with the guided action panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Linux')
    mocks.projectPath = '/repo'
    discovery = { tasks: [TEST_TASK], diagnostics: [] }
    usePreferencesStore.setState((state) => ({
      settings: { ...state.settings, recentProjects: [], projectDisplayNames: {} },
    }))
    useActionPanelStore.setState({
      request: null,
      drafts: {},
      recentlySaved: null,
    })
    serve(actionCatalog())
  })
  afterEach(() => vi.restoreAllMocks())

  it('picks a script, suggests a readable name and saves a linked task locally', async () => {
    renderSettings()
    await screen.findByText('Test')
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    const view = within(await panel())
    fireEvent.click(await view.findByRole('button', { name: /test.*vitest run/i }))
    expect(view.getByLabelText('Name')).toHaveValue('Run tests (website)')
    expect(savedEdits()).toEqual([])
    fireEvent.click(view.getByRole('button', { name: 'Save action' }))
    await waitFor(() =>
      expect(savedEdits()).toEqual([
        {
          type: 'edit',
          revision: 'catalog-1',
          edit: {
            type: 'save-action',
            storage: 'local',
            definition: expect.objectContaining({
              name: 'Run tests (website)',
              icon: 'test',
              kind: 'task',
              invocation: { type: 'task', task: TEST_TASK.reference },
            }),
          },
        },
      ]),
    )
    await waitFor(() => expect(screen.queryByTestId('action-panel')).not.toBeInTheDocument())
    expect(useActionPanelStore.getState().drafts).toEqual({})
  })

  it('keeps settings catalog and discovery in the selected checkout while runs use the active session', async () => {
    renderSettings()
    await screen.findByText('Test')
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    await within(await panel()).findByRole('button', { name: /test.*vitest run/i })
    expect(mocks.manage).toHaveBeenCalledWith({
      scope: { projectPath: '/repo' },
      operation: { type: 'catalog' },
    })
    expect(mocks.manage).toHaveBeenCalledWith({
      scope: { projectPath: '/repo' },
      operation: { type: 'discover' },
    })
    expect(mocks.manage).toHaveBeenCalledWith({
      scope: { projectPath: '/repo', sessionId: 'session' },
      operation: { type: 'runs' },
    })
  })

  it('starts on a custom command when the project has no scripts', async () => {
    discovery = { tasks: [], diagnostics: [] }
    renderSettings()
    await screen.findByText('Test')
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    const view = within(await panel())
    expect(await view.findByRole('radio', { name: /A command I type myself/ })).toBeChecked()
    fireEvent.change(view.getByLabelText('Command'), { target: { value: 'pnpm dev' } })
    fireEvent.change(view.getByLabelText('Name'), { target: { value: 'Dev' } })
    fireEvent.click(view.getByRole('button', { name: 'Save action' }))
    await waitFor(() =>
      expect(savedEdits()[0]?.edit).toMatchObject({
        type: 'save-action',
        definition: {
          name: 'Dev',
          invocation: { type: 'command', command: 'pnpm dev', directory: '.' },
        },
      }),
    )
  })

  it('keeps the command editor usable when discovery fails', async () => {
    discovery = new Error('boom')
    renderSettings()
    await screen.findByText('Test')
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    const view = within(await panel())
    fireEvent.click(await view.findByRole('radio', { name: /A script from this project/ }))
    expect(await view.findByRole('alert')).toHaveTextContent(
      'Could not read this project’s scripts',
    )
    expect(view.getByRole('button', { name: 'Try again' })).toBeEnabled()
    fireEvent.click(view.getByRole('radio', { name: /A command I type myself/ }))
    fireEvent.change(view.getByLabelText('Command'), { target: { value: 'echo hello' } })
    fireEvent.change(view.getByLabelText('Name'), { target: { value: 'Custom' } })
    expect(view.getByRole('button', { name: 'Save action' })).toBeEnabled()
  })

  it('copies a linked script as the user’s own command without changing its folder', async () => {
    renderSettings()
    await screen.findByText('Test')
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    const view = within(await panel())
    fireEvent.click(await view.findByRole('button', { name: /test.*vitest run/i }))
    fireEvent.click(view.getByRole('button', { name: 'Copy it as my own command instead' }))
    expect(view.getByLabelText('Command')).toHaveValue('pnpm run test')
    fireEvent.change(view.getByLabelText('Command'), { target: { value: 'pnpm run test --watch' } })
    fireEvent.click(view.getByRole('button', { name: 'Save action' }))
    await waitFor(() =>
      expect(savedEdits()[0]?.edit).toMatchObject({
        definition: {
          invocation: { type: 'command', command: 'pnpm run test --watch', directory: 'website' },
        },
      }),
    )
  })

  it('never lets a second action share a name, ignoring letter case', async () => {
    renderSettings()
    await screen.findByText('Test')
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    const view = within(await panel())
    fireEvent.click(await view.findByRole('radio', { name: /A command I type myself/ }))
    fireEvent.change(view.getByLabelText('Command'), { target: { value: 'pnpm test --run' } })
    fireEvent.change(view.getByLabelText('Name'), { target: { value: ' test ' } })
    expect(
      view.getByText('You already have an action called test. Pick a different name.'),
    ).toBeInTheDocument()
    expect(view.getByRole('button', { name: 'Save action' })).toBeDisabled()
  })

  it('keeps an unfinished action when the panel closes and discards it only on request', async () => {
    renderSettings()
    await screen.findByText('Test')
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    let view = within(await panel())
    fireEvent.click(await view.findByRole('radio', { name: /A command I type myself/ }))
    fireEvent.change(view.getByLabelText('Name'), { target: { value: 'Half done' } })
    fireEvent.click(view.getByRole('button', { name: 'Close. Anything unfinished is kept.' }))
    expect(screen.queryByTestId('action-panel')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    view = within(await panel())
    expect(await view.findByLabelText('Name')).toHaveValue('Half done')
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }))
    expect(view.getByText('Discard what you have so far?')).toBeInTheDocument()
    fireEvent.click(view.getByRole('button', { name: 'Discard' }))
    expect(screen.queryByTestId('action-panel')).not.toBeInTheDocument()
    expect(useActionPanelStore.getState().drafts).toEqual({})
  })

  it('asks before replacing an unfinished action with another one', async () => {
    renderSettings()
    await screen.findByText('Test')
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    const view = within(await panel())
    fireEvent.click(await view.findByRole('radio', { name: /A command I type myself/ }))
    fireEvent.change(view.getByLabelText('Name'), { target: { value: 'Half done' } })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByText('You have something unfinished')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Discard it and start this one' }))
    expect(await within(await panel()).findByLabelText('Name')).toHaveValue('Test')
  })

  it('says what changed underneath an edit and never overwrites it silently', async () => {
    renderSettings()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const view = within(await panel())
    fireEvent.change(await view.findByLabelText('Name'), { target: { value: 'My edited action' } })
    const changed = {
      ...actionCatalog(),
      revision: 'catalog-2',
      actions: [
        {
          source: 'local' as const,
          definition: {
            ...TEST_ACTION,
            invocation: { type: 'command' as const, command: 'pnpm test --run', directory: '.' },
          },
        },
      ],
    }
    serve(changed)
    fireEvent.click(view.getByRole('button', { name: 'Save changes' }))
    expect(await view.findByText('Test was changed since you started editing')).toBeInTheDocument()
    expect(view.getByText('pnpm test --run')).toBeInTheDocument()
    expect(savedEdits()).toEqual([])
    fireEvent.click(view.getByRole('button', { name: 'Keep my changes' }))
    fireEvent.click(view.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(savedEdits()[0]).toMatchObject({
        revision: 'catalog-2',
        edit: { type: 'save-action', definition: { name: 'My edited action' } },
      }),
    )
  })
})
