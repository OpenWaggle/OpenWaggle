import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type {
  AutomaticWorktreeRemovalRun,
  WorktreeInventory,
  WorktreeInventoryEntry,
} from '@shared/types/worktree-inventory'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AutomaticWorktreeRemovalLogStore } from '../../ports/automatic-worktree-removal-log'
import { WorktreeSpaceService } from '../../ports/worktree-space-service'
import { SettingsService } from '../../services/settings-service'

const { listWorktreeInventoryMock, removeHostUiWorktreeMock } = vi.hoisted(() => ({
  listWorktreeInventoryMock: vi.fn(),
  removeHostUiWorktreeMock: vi.fn(),
}))

vi.mock('../worktree-inventory', () => ({ listWorktreeInventory: listWorktreeInventoryMock }))
vi.mock('../host-ui-worktree-operation', () => ({ removeHostUiWorktree: removeHostUiWorktreeMock }))

const { AUTOMATIC_WORKTREE_REMOVAL_INTERVAL_MS, runAutomaticWorktreeRemovalPass } = await import(
  '../automatic-worktree-removal'
)

const NOW = 10 * AUTOMATIC_WORKTREE_REMOVAL_INTERVAL_MS
const MEASURED_BYTES = 2048

function entry(
  path: string,
  automaticRemoval: WorktreeInventoryEntry['automaticRemoval'],
): WorktreeInventoryEntry {
  return {
    path,
    projectPath: '/repo',
    branch: `branch${path}`,
    managed: true,
    sessions: [
      {
        sessionId: path,
        title: `Session ${path}`,
        archived: true,
        archivedAt: 1,
        running: false,
        owner: true,
      },
    ],
    blockers: [],
    uncommittedChangeCount: 0,
    unpublishedCommitCount: 0,
    archivedAt: 1,
    group: 'safe',
    attention: [],
    automaticRemoval,
  }
}

function layer(options: {
  readonly enabled: boolean
  readonly runs?: readonly AutomaticWorktreeRemovalRun[]
  readonly recorded: AutomaticWorktreeRemovalRun[]
}) {
  return Layer.mergeAll(
    Layer.succeed(SettingsService, {
      get: () =>
        Effect.succeed({
          ...DEFAULT_SETTINGS,
          automaticWorktreeRemoval: { enabled: options.enabled, archivedDays: 30 },
        }),
      update: () => Effect.void,
      initialize: () => Effect.void,
      flushForTests: () => Effect.void,
    }),
    Layer.succeed(AutomaticWorktreeRemovalLogStore, {
      read: () => Effect.succeed({ runs: options.runs ?? [], unannouncedRunId: null }),
      record: (run) => Effect.sync(() => void options.recorded.push(run)),
      acknowledge: () => Effect.void,
    }),
    Layer.succeed(WorktreeSpaceService, {
      measure: () => Effect.die('not used'),
      cached: (path) =>
        Effect.succeed(
          path === '/wt/a' ? { reclaimableBytes: MEASURED_BYTES, measuredAt: 1 } : null,
        ),
      forget: () => Effect.void,
    }),
  )
}

/** The mocked inventory and removal need none of the services the real ones read. */
function runPass(options: Parameters<typeof layer>[0]) {
  const provided = runAutomaticWorktreeRemovalPass(() => NOW).pipe(Effect.provide(layer(options)))
  return Effect.runPromise(
    fromAny<Effect.Effect<Effect.Effect.Success<typeof provided>, Error, never>, typeof provided>(
      provided,
    ),
  )
}

describe('Automatic worktree removal pass', () => {
  beforeEach(() => {
    listWorktreeInventoryMock.mockReset()
    removeHostUiWorktreeMock.mockReset()
  })

  it('does nothing while the rule is off', async () => {
    const recorded: AutomaticWorktreeRemovalRun[] = []
    await expect(runPass({ enabled: false, recorded })).resolves.toBeNull()
    expect(listWorktreeInventoryMock).not.toHaveBeenCalled()
    expect(recorded).toEqual([])
  })

  it('runs at most once a day', async () => {
    const recorded: AutomaticWorktreeRemovalRun[] = []
    const lastRun: AutomaticWorktreeRemovalRun = {
      id: 'last',
      startedAt: NOW - 1,
      finishedAt: NOW - 1,
      archivedDays: 30,
      removed: [],
      failed: [],
    }
    await expect(runPass({ enabled: true, runs: [lastRun], recorded })).resolves.toBeNull()
    expect(listWorktreeInventoryMock).not.toHaveBeenCalled()
  })

  it('removes only due worktrees, one at a time, and records what happened', async () => {
    const inventory: WorktreeInventory = {
      projects: [],
      problems: [],
      entries: [
        entry('/wt/a', { kind: 'due', dueAt: 1 }),
        entry('/wt/b', { kind: 'kept', dueAt: 1, reason: 'unpublished-commits' }),
        entry('/wt/c', { kind: 'waiting', dueAt: NOW + 1 }),
        entry('/wt/d', { kind: 'due', dueAt: 1 }),
        entry('/wt/e', { kind: 'due', dueAt: 1 }),
      ],
    }
    listWorktreeInventoryMock.mockReturnValue(Effect.succeed(inventory))
    removeHostUiWorktreeMock.mockImplementation(
      (_projectPath: string, payload: { path: string }) =>
        payload.path === '/wt/a'
          ? Effect.succeed({ ok: true })
          : payload.path === '/wt/d'
            ? Effect.succeed({ ok: false, code: 'dirty-worktree', message: 'It changed.' })
            : Effect.fail(new Error('Git crashed.')),
    )
    const recorded: AutomaticWorktreeRemovalRun[] = []

    const run = await runPass({ enabled: true, recorded })

    expect(removeHostUiWorktreeMock.mock.calls.map(([, payload]) => payload)).toEqual([
      { path: '/wt/a' },
      { path: '/wt/d' },
      { path: '/wt/e' },
    ])
    expect(run).toMatchObject({
      startedAt: NOW,
      archivedDays: 30,
      removed: [
        {
          path: '/wt/a',
          branch: 'branch/wt/a',
          sessionTitles: ['Session /wt/a'],
          reclaimableBytes: MEASURED_BYTES,
        },
      ],
      failed: [
        { path: '/wt/d', message: 'It changed.' },
        { path: '/wt/e', message: 'Git crashed.' },
      ],
    })
    expect(recorded).toEqual([run])
  })
})
