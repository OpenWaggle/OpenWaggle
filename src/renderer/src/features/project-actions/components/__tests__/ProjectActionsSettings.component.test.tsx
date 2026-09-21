import type { ActionCatalog } from '@shared/types/action-definitions'
import type {
  ActionManagementRequest,
  ActionManagementResult,
} from '@shared/types/action-management'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { actionCatalog, TEST_TASK } from './native-action-fixtures'

const mocks = vi.hoisted(() => ({
  manage: vi.fn<(request: ActionManagementRequest) => Promise<ActionManagementResult>>(),
  navigate: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/features/sessions/hooks', () => ({ useProject: () => ({ projectPath: '/repo' }) }))
vi.mock('@/features/chat/hooks', () => ({
  useChat: () => ({ activeSession: { id: 'session', projectPath: '/repo' } }),
}))
vi.mock('@/shared/lib/ipc', () => ({ api: { manageProjectActions: mocks.manage } }))

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
    serve(actionCatalog())
  })
  it('saves a discovered task reference locally only after choosing and reviewing it', async () => {
    renderWithQueryClient(<ProjectActionsSettings />)
    await screen.findByText('Test')
    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    fireEvent.click(await screen.findByRole('button', { name: /test.*Website.*vitest run/i }))
    expect(mocks.manage.mock.calls.some(([request]) => request.operation.type === 'edit')).toBe(
      false,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
    await waitFor(() =>
      expect(mocks.manage).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: { projectPath: '/repo', sessionId: 'session' },
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
