import type {
  ActionManagementRequest,
  ActionManagementResult,
} from '@shared/types/action-management'
import type { GitWorktreeMutationResult } from '@shared/types/git'
import type {
  AutomaticWorktreeRemovalLog,
  AutomaticWorktreeRemovalSettings,
  WorktreeInventory,
  WorktreeInventoryEntry,
} from '@shared/types/worktree-inventory'
import type { WorktreeRemovalPreview } from '@shared/types/worktree-usage'
import { screen, within } from '@testing-library/react'
import { vi } from 'vitest'

export const PROJECT = '/project'
export const OTHER_PROJECT = '/other'
export const MEGABYTE = 1024 * 1024

export function entry(overrides: Partial<WorktreeInventoryEntry> & { readonly path: string }) {
  return {
    projectPath: PROJECT,
    branch: `ow${overrides.path}`,
    managed: true,
    sessions: [],
    blockers: [],
    uncommittedChangeCount: 0,
    unpublishedCommitCount: 0,
    archivedAt: null,
    group: 'safe',
    attention: [],
    automaticRemoval: { kind: 'not-applicable' },
    ...overrides,
  } satisfies WorktreeInventoryEntry
}

export function inventory(entries: readonly WorktreeInventoryEntry[]): WorktreeInventory {
  return {
    projects: [
      { projectPath: PROJECT, name: 'project', opened: true },
      { projectPath: OTHER_PROJECT, name: 'other', opened: false },
    ],
    entries,
    problems: [],
  }
}

/** The preview the removal dialog reads, for a worktree nothing uses. */
export function preview(
  request: ActionManagementRequest,
  overrides: Partial<WorktreeRemovalPreview> = {},
): ActionManagementResult {
  const path = request.operation.type === 'worktree-removal-preview' ? request.operation.path : ''
  return {
    type: 'worktree-removal-preview',
    usage: { path, sessions: [], blockers: [] },
    branch: 'ow/branch',
    unpublishedCommitCount: 0,
    ...overrides,
  }
}

export function createWorktreeApiMocks() {
  return {
    getWorktreeInventory: vi.fn<() => Promise<WorktreeInventory>>(),
    measureWorktree: vi.fn(async (_projectPath: string, path: string) => ({
      path,
      reclaimableBytes: MEGABYTE,
      measuredAt: 1,
    })),
    archiveAndRemoveWorktree: vi.fn<() => Promise<GitWorktreeMutationResult>>(async () => ({
      ok: true,
      message: 'Removed.',
      path: '/wt',
    })),
    removeGitWorktree: vi.fn<() => Promise<GitWorktreeMutationResult>>(async () => ({
      ok: true,
      message: 'Removed.',
      path: '/wt',
    })),
    getAutomaticWorktreeRemovalLog: vi.fn<() => Promise<AutomaticWorktreeRemovalLog>>(async () => ({
      runs: [],
      unannouncedRunId: null,
    })),
    manageProjectActions: vi.fn<
      (request: ActionManagementRequest) => Promise<ActionManagementResult>
    >(async (request) => preview(request)),
    revealPath: vi.fn(async () => undefined),
  }
}

export function createPreferencesMock() {
  const rule: AutomaticWorktreeRemovalSettings = { enabled: false, archivedDays: 30 }
  const state = {
    settings: {
      projectPath: PROJECT,
      defaultSessionEnvironmentMode: 'local',
      automaticWorktreeRemoval: rule,
    },
    setDefaultSessionEnvironmentMode: vi.fn(async () => undefined),
    setAutomaticWorktreeRemoval: vi.fn(async () => undefined),
  }
  return state
}

/** The list item for a worktree, found by its title. */
export async function rowTitled(title: string) {
  const row = (await screen.findByText(title)).closest('li')
  if (!row) throw new Error(`no row titled ${title}`)
  return within(row)
}
