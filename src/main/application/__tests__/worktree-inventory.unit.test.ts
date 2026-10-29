import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type { WorkspacePreparation } from '@shared/types/workspace-preparation'
import type { WorktreeUsage } from '@shared/types/worktree-usage'
import { fromAny, fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { GitWorktreeService } from '../../ports/git-worktree-service'
import { SessionWorkspaceResourceRepository } from '../../ports/session-workspace-resource-repository'
import { SettingsService } from '../../services/settings-service'

const DAY = 86_400_000
const NOW = 100 * DAY

const USAGE: Record<string, Omit<WorktreeUsage, 'path'>> = {
  '/managed/old': {
    sessions: [
      {
        sessionId: 'old',
        title: 'Old work',
        archived: true,
        archivedAt: NOW - 40 * DAY,
        running: false,
        owner: true,
      },
    ],
    blockers: [],
  },
  '/managed/open': {
    sessions: [
      {
        sessionId: 'open',
        title: 'Open work',
        archived: false,
        archivedAt: null,
        running: false,
        owner: true,
      },
    ],
    blockers: [{ kind: 'session', message: 'Archive that Session first.' }],
  },
}

vi.mock('../worktree-usage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../worktree-usage')>()),
  gatherWorktreeUsageFacts: () => Effect.succeed({ facts: {} }),
  usageOfWorktree: (worktreePath: string) => ({
    path: worktreePath,
    ...(USAGE[worktreePath] ?? { sessions: [], blockers: [] }),
  }),
}))
vi.mock('../retained-workspace-preparation', () => ({
  listRetainedPreparation: (projectPath: string) =>
    Effect.succeed({
      workspaces:
        projectPath === '/other'
          ? [{ path: '/managed/failed', preparation: fromPartial<WorkspacePreparation>({}) }]
          : [],
    }),
}))
vi.mock('../../services/git/session-worktree-path', () => ({
  managedWorktreeRoot: () => '/managed',
}))

const { listWorktreeInventory } = await import('../worktree-inventory')

const OTHER_WORKTREES = [
  { path: '/other', isMain: true },
  { path: '/managed/old', isMain: false },
  { path: '/managed/failed', isMain: false },
  // In the shared managed folder, but another profile's: this database has no record of it.
  { path: '/managed/foreign', isMain: false },
  { path: '/other-by-hand', isMain: false },
]

const WORKTREES: Record<string, readonly { path: string; isMain: boolean; locked?: boolean }[]> = {
  '/open': [
    { path: '/open', isMain: true },
    { path: '/open-feature', isMain: false },
    { path: '/managed/open', isMain: false },
  ],
  // The opened project through one of its own subfolders lists the same repository again.
  '/open/packages/app': [{ path: '/open', isMain: true }],
  // Known only through a subfolder: the main checkout `/sub` is no project OpenWaggle knows.
  '/sub/packages/app': [
    { path: '/sub', isMain: true },
    { path: '/managed/sub', isMain: false },
  ],
  '/other': OTHER_WORKTREES,
  // Listed first from inside one of its own linked worktrees; `/other` lists it again.
  '/other-by-hand': OTHER_WORKTREES,
}

const layer = Layer.mergeAll(
  Layer.succeed(SettingsService, {
    get: () =>
      Effect.succeed({
        ...DEFAULT_SETTINGS,
        projectPath: '/open',
        recentProjects: ['/open/packages/app', '/other-by-hand', '/sub/packages/app'],
        projectDisplayNames: { '/other': 'Other app' },
        automaticWorktreeRemoval: { enabled: true, archivedDays: 30 },
      }),
    update: () => Effect.void,
    initialize: () => Effect.void,
    flushForTests: () => Effect.void,
  }),
  Layer.succeed(
    SessionWorkspaceResourceRepository,
    fromPartial({
      listManagedWorktreeRemovalCandidates: () =>
        Effect.succeed([
          { id: 'w1', projectPath: '/other', workingPath: '/managed/old' },
          { id: 'w2', projectPath: '/open', workingPath: '/managed/open' },
          { id: 'w3', projectPath: '/other', workingPath: '/managed/failed' },
        ]),
    }),
  ),
  Layer.succeed(
    GitWorktreeService,
    fromPartial({
      list: (projectPath: string) =>
        Effect.succeed({
          worktrees: (WORKTREES[projectPath] ?? []).map((worktree) => ({
            ...worktree,
            branch: `branch-of-${worktree.path}`,
            head: 'abc',
          })),
        }),
      countUncommittedChanges: () => Effect.succeed(0),
      countUnpublishedCommits: (worktreePath: string) =>
        Effect.succeed(worktreePath === '/managed/failed' ? null : 0),
    }),
  ),
)

/** The mocked usage and cleanup reads need no terminals, Actions or preparation. */
function inventory() {
  const provided = listWorktreeInventory(NOW).pipe(Effect.provide(layer))
  return Effect.runPromise(
    fromAny<Effect.Effect<Effect.Effect.Success<typeof provided>, Error, never>, typeof provided>(
      provided,
    ),
  )
}

describe('Settings > Worktrees inventory', () => {
  it('lists managed worktrees everywhere and hand-made ones only for the opened project', async () => {
    const listed = await inventory()

    expect(listed.entries.map((entry) => entry.path).sort()).toEqual([
      '/managed/failed',
      '/managed/foreign',
      '/managed/old',
      '/managed/open',
      '/managed/sub',
      '/open-feature',
    ])
    // Each repository acts through a project OpenWaggle knows, from its main checkout if it can.
    expect(listed.projects).toEqual([
      { projectPath: '/open', name: 'open', opened: true },
      { projectPath: '/other', name: 'Other app', opened: false },
      { projectPath: '/sub/packages/app', name: 'app', opened: false },
    ])
    expect(listed.entries.find((entry) => entry.path === '/managed/sub')).toMatchObject({
      projectPath: '/sub/packages/app',
    })
    expect(listed.problems).toEqual([])
  })

  it('classifies each worktree and decides what Automatic worktree removal does with it', async () => {
    const byPath = new Map((await inventory()).entries.map((entry) => [entry.path, entry]))

    expect(byPath.get('/managed/old')).toMatchObject({
      projectPath: '/other',
      managed: true,
      group: 'safe',
      archivedAt: NOW - 40 * DAY,
      automaticRemoval: { kind: 'due', dueAt: NOW - 10 * DAY },
    })
    expect(byPath.get('/managed/open')).toMatchObject({
      group: 'in-use',
      attention: [{ kind: 'open-sessions', count: 1 }],
      automaticRemoval: { kind: 'not-applicable' },
    })
    expect(byPath.get('/managed/failed')).toMatchObject({
      group: 'decide',
      // Its recovery runs in the project whose cleanup failed.
      cleanupFailure: { projectPath: '/other', preparation: {} },
      attention: [{ kind: 'cleanup-failed' }, { kind: 'unknown-state' }],
    })
    expect(byPath.get('/managed/foreign')).toMatchObject({
      managed: false,
      group: 'decide',
      attention: [{ kind: 'unrecorded' }],
      automaticRemoval: { kind: 'not-applicable' },
    })
    expect(byPath.get('/open-feature')).toMatchObject({
      managed: false,
      group: 'decide',
      attention: [{ kind: 'unmanaged' }],
    })
  })
})
