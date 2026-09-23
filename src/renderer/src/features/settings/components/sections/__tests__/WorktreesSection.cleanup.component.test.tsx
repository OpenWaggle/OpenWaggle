import type {
  ActionManagementRequest,
  ActionManagementResult,
} from '@shared/types/action-management'
import type { WorkspacePreparation } from '@shared/types/workspace-preparation'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const mocks = vi.hoisted(() => ({
  manage: vi.fn<(request: ActionManagementRequest) => Promise<ActionManagementResult>>(),
  remove: vi.fn(),
}))
vi.mock('@/features/settings/state/preferences-store', () => ({
  usePreferencesStore: (select: (value: unknown) => unknown) =>
    select({ settings: { projectPath: '/project', defaultSessionEnvironmentMode: 'local' } }),
}))
vi.mock('@/shared/lib/ipc', () => ({
  api: {
    manageProjectActions: mocks.manage,
    removeGitWorktree: mocks.remove,
    listGitWorktrees: async () => ({
      worktrees: [{ path: '/worktree', branch: 'feature', head: 'abc', isMain: false }],
    }),
  },
}))

import { WorktreesSection } from '../WorktreesSection'

it('shows retained cleanup recovery when Settings reopens without another removal attempt', async () => {
  const preparation = fromPartial<WorkspacePreparation>({
    workspaceId: 'workspace',
    revision: 3,
    snapshot: { definitions: [] },
    cleanup: { status: 'failed', error: 'cleanup exited with code 1.', output: '' },
  })
  mocks.manage.mockImplementation(async ({ operation }) =>
    operation.type === 'retained-preparation'
      ? { type: 'retained-preparation', workspaces: [{ path: '/worktree', preparation }] }
      : { type: 'preparation', preparation },
  )
  renderWithQueryClient(<WorktreesSection />)
  expect(await screen.findByRole('button', { name: 'Retry cleanup' })).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('cleanup exited with code 1.')
})

it('keeps Delete anyway available after a replaced checkout with succeeded cleanup', async () => {
  const preparation = fromPartial<WorkspacePreparation>({
    workspaceId: 'workspace',
    revision: 3,
    snapshot: { definitions: [] },
    cleanup: { status: 'succeeded', output: '' },
  })
  mocks.manage.mockImplementation(async ({ operation }) =>
    operation.type === 'retained-preparation'
      ? {
          type: 'retained-preparation',
          workspaces: [{ path: '/worktree', preparation, generationMismatch: true }],
        }
      : { type: 'preparation', preparation },
  )
  mocks.remove.mockResolvedValue({ ok: true, message: 'Worktree removed.' })

  renderWithQueryClient(<WorktreesSection />)
  expect(await screen.findByText(/This checkout no longer matches/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Retry cleanup' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Delete anyway…'))
  fireEvent.click(screen.getByRole('button', { name: 'Delete anyway' }))
  await waitFor(() =>
    expect(mocks.remove).toHaveBeenCalledWith('/project', {
      path: '/worktree',
      skipCleanup: true,
    }),
  )
})

it('offers explicit force removal after cleanup succeeds but the worktree remains', async () => {
  const preparation = fromPartial<WorkspacePreparation>({
    workspaceId: 'workspace',
    revision: 3,
    snapshot: { definitions: [] },
    cleanup: { status: 'succeeded', output: '' },
  })
  mocks.manage.mockImplementation(async ({ operation }) =>
    operation.type === 'retained-preparation'
      ? { type: 'retained-preparation', workspaces: [{ path: '/worktree', preparation }] }
      : { type: 'preparation', preparation },
  )
  mocks.remove.mockResolvedValue({ ok: true, message: 'Worktree removed.' })

  renderWithQueryClient(<WorktreesSection />)
  expect(await screen.findByRole('button', { name: 'Retry removal' })).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Cleanup completed')
  fireEvent.click(screen.getByText('Force remove…'))
  expect(screen.getByText(/uncommitted changes or is locked/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Force remove' }))
  await waitFor(() =>
    expect(mocks.remove).toHaveBeenCalledWith('/project', {
      path: '/worktree',
      skipCleanup: true,
      force: true,
    }),
  )
})

it('keeps Git worktrees available when cleanup metadata fails to load', async () => {
  mocks.manage.mockRejectedValue(new Error('Invalid actions.json'))
  renderWithQueryClient(<WorktreesSection />)
  expect(await screen.findByRole('button', { name: 'Remove' })).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Invalid actions.json')
  expect(screen.queryByText('No worktrees for this repository.')).not.toBeInTheDocument()
})
