import { DEFAULT_SETTINGS } from '@shared/types/settings'
import type {
  AutomaticWorktreeRemovalRun,
  WorktreeInventory,
  WorktreeInventoryEntry,
} from '@shared/types/worktree-inventory'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
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
  readonly lastCheckedAt?: number
  readonly recorded: AutomaticWorktreeRemovalRun[]
  readonly checks?: boolean[]
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
      read: () =>
        Effect.succeed({
          lastCheckedAt: options.lastCheckedAt ?? null,
          runs: [],
          unannouncedRunId: null,
        }),
      record: (run, { checked }) =>
        Effect.sync(() => {
          options.recorded.push(run)
          options.checks?.push(checked)
        }),
      acknowledge: () => Effect.succeed(false),
    }),
    Layer.succeed(WorktreeSpaceService, {
      // Each due worktree is measured just before its removal; one that cannot be has no size.
      measure: (path) =>
        path === '/wt/a'
          ? Effect.succeed({ reclaimableBytes: MEASURED_BYTES, measuredAt: 1 })
          : Effect.fail(new Error('Unreadable.')),
      cached: () => Effect.die('not used'),
      forget: () => Effect.void,
    }),
  )
}

/** The mocked inventory and removal need none of the services the real ones read. */
function pass(options: Parameters<typeof layer>[0], isDraining = () => false) {
  const provided = runAutomaticWorktreeRemovalPass(() => NOW, isDraining).pipe(
    Effect.provide(layer(options)),
  )
  return fromAny<
    Effect.Effect<Effect.Effect.Success<typeof provided>, Error, never>,
    typeof provided
  >(provided)
}

function runPass(options: Parameters<typeof layer>[0], isDraining = () => false) {
  return Effect.runPromise(pass(options, isDraining))
}

function listing(...entries: WorktreeInventoryEntry[]): WorktreeInventory {
  return { projects: [], problems: [], entries }
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
    await expect(runPass({ enabled: true, lastCheckedAt: NOW - 1, recorded })).resolves.toBeNull()
    expect(listWorktreeInventoryMock).not.toHaveBeenCalled()
  })

  it('starts nothing while the Host drains, and stops between worktrees once it does', async () => {
    await expect(runPass({ enabled: true, recorded: [] }, () => true)).resolves.toBeNull()
    expect(listWorktreeInventoryMock).not.toHaveBeenCalled()

    listWorktreeInventoryMock.mockReturnValue(
      Effect.succeed({
        projects: [],
        problems: [],
        entries: [
          entry('/wt/a', { kind: 'due', dueAt: 1 }),
          entry('/wt/b', { kind: 'due', dueAt: 1 }),
        ],
      }),
    )
    let draining = false
    removeHostUiWorktreeMock.mockImplementation(() =>
      Effect.sync(() => {
        draining = true
        return { ok: true }
      }),
    )
    const checks: boolean[] = []
    const run = await runPass({ enabled: true, recorded: [], checks }, () => draining)
    expect(run?.removed.map((removed) => removed.path)).toEqual(['/wt/a'])
    // The next Host's pass finishes the job instead of waiting a day.
    expect(checks).toEqual([false])
  })

  it('keeps a worktree that a fresh read just before its removal no longer finds due', async () => {
    listWorktreeInventoryMock
      .mockReturnValueOnce(Effect.succeed(listing(entry('/wt/a', { kind: 'due', dueAt: 1 }))))
      // Its Session was restored and archived again while the pass measured it.
      .mockReturnValueOnce(
        Effect.succeed(listing(entry('/wt/a', { kind: 'waiting', dueAt: NOW + 1 }))),
      )
    const run = await runPass({ enabled: true, recorded: [] })

    expect(listWorktreeInventoryMock).toHaveBeenLastCalledWith(NOW, { onlyPath: '/wt/a' })
    expect(removeHostUiWorktreeMock).not.toHaveBeenCalled()
    expect(run).toMatchObject({ removed: [], failed: [] })
  })

  it('records what it removed when the Host stops it part-way', async () => {
    listWorktreeInventoryMock.mockReturnValue(
      Effect.succeed(
        listing(
          entry('/wt/a', { kind: 'due', dueAt: 1 }),
          entry('/wt/b', { kind: 'due', dueAt: 1 }),
          entry('/wt/c', { kind: 'due', dueAt: 1 }),
        ),
      ),
    )
    // The second removal is under way when the Host stops the pass; it finishes regardless.
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    removeHostUiWorktreeMock.mockImplementation(
      (_projectPath: string, payload: { path: string }) =>
        payload.path === '/wt/b'
          ? Effect.promise(() => gate).pipe(Effect.as({ ok: true }))
          : Effect.succeed({ ok: true }),
    )
    const recorded: AutomaticWorktreeRemovalRun[] = []
    const checks: boolean[] = []
    const fiber = Effect.runFork(pass({ enabled: true, recorded, checks }))
    await vi.waitFor(() => expect(removeHostUiWorktreeMock).toHaveBeenCalledTimes(2))

    const stopped = Effect.runPromise(Fiber.interrupt(fiber))
    release()
    await stopped

    expect(recorded.map((run) => run.removed.map((removed) => removed.path))).toEqual([
      ['/wt/a', '/wt/b'],
    ])
    expect(checks).toEqual([false])
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
    const checks: boolean[] = []

    const run = await runPass({ enabled: true, recorded, checks })

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
    expect(checks).toEqual([true])
  })
})
