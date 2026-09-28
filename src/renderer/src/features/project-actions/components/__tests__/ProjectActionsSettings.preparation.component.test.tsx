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
import { actionCatalog, TEST_TASK } from './native-action-fixtures'

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

describe('worktree setup in the guided action panel', () => {
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
      lastSeenScriptCommands: {},
      recentlySaved: null,
    })
    serve(actionCatalog())
  })
  afterEach(() => vi.restoreAllMocks())

  it('reviews a shared setup in the panel and turns it on only on request', async () => {
    serve({
      ...actionCatalog(),
      preparation: [
        {
          source: 'project',
          review: 'required',
          definition: {
            id: 'setup',
            profileId: 'default',
            phase: 'setup',
            invocation: { type: 'command', command: 'pnpm install', directory: '.' },
          },
        },
      ],
    })
    renderSettings()
    expect(await screen.findByText('Check it before it runs')).toBeInTheDocument()
    expect(screen.queryByLabelText('Setup profile')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check it' }))
    const view = within(await panel())
    expect(view.getByText('Check this shared setup')).toBeInTheDocument()
    expect(view.getByText('pnpm install')).toBeInTheDocument()
    expect(savedEdits()).toEqual([])
    fireEvent.click(view.getByRole('button', { name: 'Turn on this version' }))
    await waitFor(() =>
      expect(savedEdits()).toEqual([
        {
          type: 'edit',
          revision: 'catalog-1',
          edit: { type: 'review-preparation', id: 'setup', enabled: true },
        },
      ]),
    )
  })

  it('configures worktree setup in the same panel', async () => {
    renderSettings()
    const [configureSetup] = await screen.findAllByRole('button', { name: 'Configure' })
    if (!configureSetup) throw new Error('Configure setup is missing')
    fireEvent.click(configureSetup)
    const view = within(await panel())
    expect(view.getByText('Set up new worktrees')).toBeInTheDocument()
    fireEvent.click(await view.findByRole('radio', { name: /A command I type myself/ }))
    fireEvent.change(view.getByLabelText('Command'), { target: { value: 'pnpm install' } })
    fireEvent.click(view.getByRole('button', { name: 'Save setup' }))
    await waitFor(() =>
      expect(savedEdits()[0]?.edit).toMatchObject({
        type: 'save-preparation',
        storage: 'local',
        definition: {
          phase: 'setup',
          profileId: 'default',
          invocation: { command: 'pnpm install' },
        },
      }),
    )
  })
})
