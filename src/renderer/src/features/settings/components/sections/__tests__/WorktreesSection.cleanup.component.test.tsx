import type {
  ActionManagementRequest,
  ActionManagementResult,
} from '@shared/types/action-management'
import type { WorkspacePreparation } from '@shared/types/workspace-preparation'
import { screen } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const mocks = vi.hoisted(() => ({
  manage: vi.fn<(request: ActionManagementRequest) => Promise<ActionManagementResult>>(),
}))
vi.mock('@/features/settings/state/preferences-store', () => ({
  usePreferencesStore: (select: (value: unknown) => unknown) =>
    select({ settings: { projectPath: '/project', defaultSessionEnvironmentMode: 'local' } }),
}))
vi.mock('@/shared/lib/ipc', () => ({
  api: {
    manageProjectActions: mocks.manage,
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
