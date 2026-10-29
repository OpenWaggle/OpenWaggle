import type { WorkspacePreparation } from '@shared/types/workspace-preparation'
import type { WorktreeCleanupFailure } from '@shared/types/worktree-inventory'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import {
  createPreferencesMock,
  createWorktreeApiMocks,
  entry,
  inventory,
  PROJECT,
  preview,
} from './worktree-inventory-fixtures'

const mocks = vi.hoisted(() => {
  const api: Record<string, unknown> = {}
  const preferences: Record<string, unknown> = {}
  return { api, preferences }
})
vi.mock('@/features/settings/state/preferences-store', () => ({
  usePreferencesStore: (select: (value: unknown) => unknown) => select(mocks.preferences),
}))
vi.mock('@/shared/lib/ipc', () => ({ api: mocks.api }))

import { WorktreesSection } from '../WorktreesSection'

let api = createWorktreeApiMocks()

function preparation(cleanup: WorkspacePreparation['cleanup']) {
  return fromPartial<WorkspacePreparation>({
    workspaceId: 'workspace',
    revision: 3,
    snapshot: { definitions: [] },
    setup: { status: 'idle' },
    cleanup,
  })
}

const FAILED = preparation(
  fromPartial({ status: 'failed', error: 'cleanup exited with code 1.', output: '' }),
)
const SUCCEEDED = preparation(fromPartial({ status: 'succeeded', output: '' }))

/** One archived worktree whose Workspace cleanup failed and kept it (ADR 0038). */
function failedWorktree(cleanupFailure: WorktreeCleanupFailure) {
  api.getWorktreeInventory.mockResolvedValue(
    inventory([
      entry({
        path: '/worktree',
        group: 'decide',
        attention: [{ kind: 'cleanup-failed' }],
        cleanupFailure,
      }),
    ]),
  )
  api.manageProjectActions.mockImplementation(async (request) =>
    request.operation.type === 'worktree-removal-preview'
      ? preview(request)
      : { type: 'preparation', preparation: cleanupFailure.preparation },
  )
}

/** Every removal asks first (issue #353); these tests confirm it as the user does. */
async function confirmRemoval(name = 'Remove worktree') {
  const confirm = await screen.findByRole('button', { name })
  await waitFor(() => expect(confirm).toBeEnabled())
  fireEvent.click(confirm)
}

beforeEach(() => {
  api = createWorktreeApiMocks()
  Object.assign(mocks.api, api)
  Object.assign(mocks.preferences, createPreferencesMock())
})

it('shows retained cleanup recovery when Settings reopens', async () => {
  failedWorktree({ preparation: FAILED })
  renderWithQueryClient(<WorktreesSection />)
  expect(await screen.findByRole('button', { name: 'Retry cleanup' })).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('cleanup exited with code 1.')
  expect(screen.getByText('Workspace cleanup failed')).toBeInTheDocument()
})

it('keeps Delete anyway available for a checkout that cannot be matched', async () => {
  failedWorktree({
    preparation: SUCCEEDED,
    generationMismatch: true,
    generationMismatchMessage:
      'This worktree cannot be checked against the checkout that captured its preparation: the preparation has no record of the folder /worktree.',
  })
  renderWithQueryClient(<WorktreesSection />)
  expect(
    await screen.findByText(/the preparation has no record of the folder \/worktree/),
  ).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Retry cleanup' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Delete anyway…'))
  fireEvent.click(screen.getByRole('button', { name: 'Delete anyway' }))
  await confirmRemoval()
  await waitFor(() =>
    expect(api.removeGitWorktree).toHaveBeenCalledWith(PROJECT, {
      path: '/worktree',
      skipCleanup: true,
    }),
  )
})

it('offers removal without cleanup after cleanup succeeds but the worktree remains', async () => {
  failedWorktree({ preparation: SUCCEEDED })
  renderWithQueryClient(<WorktreesSection />)
  expect(await screen.findByRole('button', { name: 'Retry removal' })).toBeInTheDocument()
  fireEvent.click(screen.getByText('Force remove…'))
  fireEvent.click(screen.getByRole('button', { name: 'Force remove' }))
  await confirmRemoval('Remove without cleanup')
  await waitFor(() =>
    expect(api.removeGitWorktree).toHaveBeenCalledWith(PROJECT, {
      path: '/worktree',
      skipCleanup: true,
      force: true,
    }),
  )
})

it('leaves a failed cleanup reason to the row instead of a brief toast', async () => {
  const { useUIStore } = await import('@/shell/ui-store')
  failedWorktree({ preparation: FAILED })
  api.removeGitWorktree.mockResolvedValue({
    ok: false,
    code: 'cleanup-failed',
    message: 'Workspace cleanup is failed. cleanup exited with code 1. The worktree was retained.',
  })
  renderWithQueryClient(<WorktreesSection />)
  fireEvent.click(await screen.findByRole('button', { name: 'Retry cleanup' }))
  await confirmRemoval()
  await waitFor(() =>
    expect(useUIStore.getState().toastMessage).toBe(
      'The worktree was kept. The reason is shown under it.',
    ),
  )
})

it('puts the full reason in the toast when the refreshed list cannot show it', async () => {
  const { useUIStore } = await import('@/shell/ui-store')
  failedWorktree({ preparation: FAILED })
  const message =
    'Workspace cleanup is failed. cleanup exited with code 1. The worktree was retained.'
  api.removeGitWorktree.mockImplementation(async () => {
    api.getWorktreeInventory.mockResolvedValue(inventory([]))
    return { ok: false, code: 'cleanup-failed', message }
  })
  renderWithQueryClient(<WorktreesSection />)
  fireEvent.click(await screen.findByRole('button', { name: 'Retry cleanup' }))
  await confirmRemoval()
  await waitFor(() => expect(useUIStore.getState().toastMessage).toBe(message))
})

it('names the reason when removal itself fails', async () => {
  const { useUIStore } = await import('@/shell/ui-store')
  failedWorktree({ preparation: FAILED })
  api.removeGitWorktree.mockRejectedValue(
    new Error(
      "Error invoking remote method 'git:worktrees:remove': Error: /worktree could not be read (EACCES).",
    ),
  )
  renderWithQueryClient(<WorktreesSection />)
  fireEvent.click(await screen.findByRole('button', { name: 'Retry cleanup' }))
  await confirmRemoval()
  await waitFor(() =>
    expect(useUIStore.getState().toastMessage).toBe(
      'Could not remove the worktree: /worktree could not be read (EACCES).',
    ),
  )
})

it('still lists worktrees when part of the inventory could not be read', async () => {
  api.getWorktreeInventory.mockResolvedValue({
    ...inventory([entry({ path: '/wt/free' })]),
    problems: ['Could not load cleanup recovery: Invalid actions.json'],
  })
  renderWithQueryClient(<WorktreesSection />)
  expect(await screen.findByRole('button', { name: 'Remove free' })).toBeInTheDocument()
  expect(screen.getByRole('status', { name: 'Inventory problems' })).toHaveTextContent(
    'Invalid actions.json',
  )
})
