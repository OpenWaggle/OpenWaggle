import type { ActionCatalog } from '@shared/types/action-definitions'
import type {
  ActionManagementRequest,
  ActionManagementResult,
} from '@shared/types/action-management'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings/state'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
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

function serve(catalog: ActionCatalog) {
  mocks.manage.mockImplementation(async ({ operation }) => {
    if (operation.type === 'catalog' || operation.type === 'edit')
      return { type: 'catalog', catalog }
    if (operation.type === 'runs') return { type: 'runs', runs: [] }
    if (operation.type === 'discover')
      return { type: 'discovery', discovery: { tasks: [TEST_TASK], diagnostics: [] } }
    throw new Error(`Unexpected operation ${operation.type}`)
  })
}
describe('native action settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Linux')
    mocks.projectPath = '/repo'
    usePreferencesStore.setState((state) => ({
      settings: { ...state.settings, recentProjects: [], projectDisplayNames: {} },
    }))
    serve(actionCatalog())
  })
  afterEach(() => vi.restoreAllMocks())
  it('saves a discovered task reference locally only after choosing and reviewing it', async () => {
    renderWithQueryClient(<ProjectActionsSettings />)
    await screen.findByText('Test')
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    expect(screen.getByLabelText('Command')).toHaveValue('')
    fireEvent.click(await screen.findByRole('button', { name: /test.*Website.*vitest run/i }))
    expect(screen.getByLabelText('Command')).toHaveValue('pnpm run test')
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument()
    expect(mocks.manage.mock.calls.some(([request]) => request.operation.type === 'edit')).toBe(
      false,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
    await waitFor(() =>
      expect(mocks.manage).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: { projectPath: '/repo' },
          operation: {
            type: 'edit',
            revision: 'catalog-1',
            edit: {
              type: 'save-action',
              storage: 'local',
              definition: expect.objectContaining({
                invocation: { type: 'task', task: TEST_TASK.reference },
              }),
            },
          },
        }),
      ),
    )
  })
  it('keeps settings catalog and discovery in the selected checkout while runs use the active session', async () => {
    renderWithQueryClient(<ProjectActionsSettings />)
    await screen.findByText('Test')
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    await screen.findByRole('button', { name: /test.*Website.*vitest run/i })
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
  it('keeps custom commands available when discovery has no scripts', async () => {
    const original = mocks.manage.getMockImplementation()
    mocks.manage.mockImplementation(async (request) => {
      if (request.operation.type === 'discover')
        return { type: 'discovery', discovery: { tasks: [], diagnostics: [] } }
      if (!original) throw new Error('Missing fixture')
      return original(request)
    })
    renderWithQueryClient(<ProjectActionsSettings />)
    await screen.findByText('Test')
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    await screen.findByText('No scripts detected. Enter a command below.')
    expect(
      screen.queryByRole('textbox', { name: 'Filter project scripts' }),
    ).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dev' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'pnpm dev' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
    await waitFor(() =>
      expect(mocks.manage).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: expect.objectContaining({
            type: 'edit',
            edit: expect.objectContaining({
              storage: 'local',
              definition: expect.objectContaining({
                invocation: { type: 'command', command: 'pnpm dev', directory: '.' },
              }),
            }),
          }),
        }),
      ),
    )
  })
  it('keeps an active script filter visible when refresh returns fewer scripts', async () => {
    const original = mocks.manage.getMockImplementation()
    let tasks = Array.from({ length: 7 }, (_, index) => ({
      ...TEST_TASK,
      reference: { ...TEST_TASK.reference, task: `script-${index}` },
    }))
    mocks.manage.mockImplementation(async (request) => {
      if (request.operation.type === 'discover')
        return { type: 'discovery', discovery: { tasks, diagnostics: [] } }
      if (!original) throw new Error('Missing fixture')
      return original(request)
    })
    renderWithQueryClient(<ProjectActionsSettings />)
    await screen.findByText('Test')
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    fireEvent.change(await screen.findByLabelText('Filter project scripts'), {
      target: { value: 'script-6' },
    })
    tasks = tasks.slice(0, 1)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByText('No scripts match your filter.')
    fireEvent.change(screen.getByLabelText('Filter project scripts'), {
      target: { value: '' },
    })
    expect(screen.getByRole('button', { name: /script-0/ })).toBeVisible()
  })
  it('keeps the command editor usable when discovery fails', async () => {
    const original = mocks.manage.getMockImplementation()
    mocks.manage.mockImplementation(async (request) => {
      if (request.operation.type === 'discover') throw new Error('Invalid package.json')
      if (!original) throw new Error('Missing fixture')
      return original(request)
    })
    renderWithQueryClient(<ProjectActionsSettings />)
    await screen.findByText('Test')
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not read project scripts')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Custom' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'echo hello' } })
    expect(screen.getByRole('button', { name: 'Save action' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
  })
  it('has an actionable project picker when no project has ever been selected', () => {
    mocks.projectPath = null
    renderWithQueryClient(<ProjectActionsSettings />)
    expect(screen.getByRole('button', { name: 'Project: Choose project' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Open project folder' })).toBeEnabled()
    expect(screen.getByText('Choose a project to manage its actions')).toBeInTheDocument()
    expect(mocks.manage).not.toHaveBeenCalled()
  })
  it('manages a chosen project without changing the active session project', async () => {
    usePreferencesStore.setState((state) => ({
      settings: { ...state.settings, recentProjects: ['/other'] },
    }))
    renderWithQueryClient(<ProjectActionsSettings />)
    await screen.findByText('Test')
    fireEvent.click(screen.getByRole('button', { name: 'Project: repo' }))
    fireEvent.click(screen.getByRole('button', { name: 'other (/other)' }))
    await waitFor(() =>
      expect(mocks.manage).toHaveBeenCalledWith({
        scope: { projectPath: '/other' },
        operation: { type: 'catalog' },
      }),
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add action' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Other command' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'echo other' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
    await waitFor(() =>
      expect(mocks.manage).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: { projectPath: '/other' },
          operation: expect.objectContaining({ type: 'edit' }),
        }),
      ),
    )
    expect(mocks.projectPath).toBe('/repo')
  })
  it('converts an edited linked script to a custom command without changing its directory', async () => {
    renderWithQueryClient(<ProjectActionsSettings />)
    await screen.findByText('Test')
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    fireEvent.click(await screen.findByRole('button', { name: /test.*Website.*vitest run/i }))
    fireEvent.change(screen.getByLabelText('Command'), {
      target: { value: 'pnpm run test --watch' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
    await waitFor(() =>
      expect(mocks.manage).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: expect.objectContaining({
            type: 'edit',
            edit: expect.objectContaining({
              definition: expect.objectContaining({
                invocation: {
                  type: 'command',
                  command: 'pnpm run test --watch',
                  directory: 'website',
                },
              }),
            }),
          }),
        }),
      ),
    )
  })
  it('shows preparation separately and requires an explicit enablement decision for shared commands', async () => {
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
    renderWithQueryClient(<ProjectActionsSettings />)
    expect(await screen.findByText('Review required')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }))
    expect(screen.getByText('No previous review')).toBeInTheDocument()
    expect(mocks.manage.mock.calls.some(([request]) => request.operation.type === 'edit')).toBe(
      false,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Enable this version' }))
    await waitFor(() =>
      expect(mocks.manage).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: {
            type: 'edit',
            revision: 'catalog-1',
            edit: { type: 'review-preparation', id: 'setup', enabled: true },
          },
        }),
      ),
    )
  })
  it('retains a draft after a conflicting save and offers an explicit reload', async () => {
    const original = mocks.manage.getMockImplementation()
    mocks.manage.mockImplementation(async (request) => {
      if (request.operation.type === 'edit')
        throw new Error('Project Actions changed. Reload before saving.')
      if (!original) throw new Error('Missing fixture')
      return original(request)
    })
    renderWithQueryClient(<ProjectActionsSettings />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My edited action' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Project Actions changed')
    expect(screen.getByLabelText('Name')).toHaveValue('My edited action')
    expect(
      screen.getByRole('button', { name: 'Reload catalog and keep my draft' }),
    ).toBeInTheDocument()
  })
})
