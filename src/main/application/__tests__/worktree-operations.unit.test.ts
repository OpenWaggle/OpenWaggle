import type { WorktreeUsage } from '@shared/types/worktree-usage'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GitWorktreeService } from '../../ports/git-worktree-service'

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  remove: vi.fn(),
  usage: vi.fn(),
}))

vi.mock('../local-session-command-dispatcher', () => ({
  dispatchNonHostUiLocalSessionCommand: mocks.dispatch,
}))
vi.mock('../host-ui-worktree-operation', () => ({ removeHostUiWorktree: mocks.remove }))
vi.mock('../worktree-usage', () => ({
  // Canonical spelling: a trailing slash stands in for any other spelling of the same folder.
  createCanonicalizer: () => async (value: string) => value.replace(/\/+$/, ''),
  gatherWorktreeUsageFacts: () => Effect.succeed({ facts: {} }),
  usageOfWorktree: mocks.usage,
}))

const { archiveAndRemoveWorktreeOperation } = await import('../worktree-operations')

const PROJECT = '/repo'
const WORKTREE = '/wt/feature'

const gitLayer = Layer.succeed(
  GitWorktreeService,
  GitWorktreeService.of({
    list: () =>
      Effect.succeed({
        worktrees: [
          { path: PROJECT, branch: 'main', head: 'a', isMain: true },
          { path: WORKTREE, branch: 'feature', head: 'b', isMain: false },
        ],
      }),
    create: () => Effect.die('not used'),
    remove: () => Effect.die('not used'),
    validateRemoval: () => Effect.die('not used'),
    countUnpublishedCommits: () => Effect.die('not used'),
    countUncommittedChanges: () => Effect.die('not used'),
    applicationCheckout: () => Effect.die('not used'),
    inspectLinkedWorktree: () => Effect.die('not used'),
  }),
)

function usage(overrides: Partial<WorktreeUsage> = {}): WorktreeUsage {
  return {
    path: WORKTREE,
    sessions: [
      {
        sessionId: 'open',
        title: 'Open',
        archived: false,
        archivedAt: null,
        running: false,
        owner: true,
      },
      {
        sessionId: 'done',
        title: 'Done',
        archived: true,
        archivedAt: 5,
        running: false,
        owner: true,
      },
    ],
    blockers: [{ kind: 'session', message: 'Archive that Session first.' }],
    ...overrides,
  }
}

/** The mocked operations need only Git's worktree list. */
function run(
  path = WORKTREE,
  sessionIds: readonly string[] = ['open', 'done'],
  flags: { readonly keepWorktree?: boolean } = {},
) {
  const provided = archiveAndRemoveWorktreeOperation(PROJECT, {
    path,
    sessionIds,
    force: true,
    ...flags,
  }).pipe(Effect.provide(gitLayer))
  return Effect.runPromise(
    fromAny<Effect.Effect<Effect.Effect.Success<typeof provided>, unknown, never>, typeof provided>(
      provided,
    ),
  )
}

describe('Archive & remove', () => {
  beforeEach(() => {
    mocks.dispatch.mockReset()
    mocks.remove.mockReset()
    mocks.usage.mockReset()
    mocks.dispatch.mockReturnValue(
      Effect.succeed({
        contract: 'session-control-v2',
        response: { outcome: { effect: 'session-archived' } },
      }),
    )
    mocks.remove.mockReturnValue(Effect.succeed({ ok: true }))
  })

  it('archives each open Session, then removes the worktree with every check', async () => {
    mocks.usage.mockReturnValue(usage())

    await expect(run()).resolves.toEqual({ ok: true })

    expect(mocks.dispatch).toHaveBeenCalledTimes(1)
    expect(mocks.dispatch.mock.calls[0]?.[0]).toMatchObject({
      payload: { request: { command: { operation: 'archive', sessionId: 'open' } } },
    })
    expect(mocks.remove).toHaveBeenCalledWith(PROJECT, {
      path: WORKTREE,
      force: true,
      lockOnly: true,
    })
  })

  it('archives nothing while a Run, terminal or Action uses the worktree', async () => {
    mocks.usage.mockReturnValue(
      usage({ blockers: [{ kind: 'terminal', message: 'A terminal is open in it.' }] }),
    )
    await expect(run()).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('A terminal is open in it.'),
    })

    mocks.usage.mockReturnValue(
      usage({
        sessions: [
          {
            sessionId: 'r',
            title: 'Busy',
            archived: false,
            archivedAt: null,
            running: true,
            owner: true,
          },
        ],
      }),
    )
    await expect(run(WORKTREE, ['r'])).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('“Busy” has a Run'),
    })
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('archives nothing when the Sessions differ from the ones the confirmation named', async () => {
    mocks.usage.mockReturnValue(usage())
    for (const named of [['open'], ['open', 'done', 'gone'], ['open', 'other']]) {
      await expect(run(WORKTREE, named)).resolves.toMatchObject({
        ok: false,
        message: expect.stringContaining('The Sessions in this worktree changed'),
      })
    }
    expect(mocks.dispatch).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('says the Sessions stay archived when the removal is then refused', async () => {
    mocks.usage.mockReturnValue(usage())
    mocks.remove.mockReturnValue(
      Effect.succeed({ ok: false, code: 'dirty-worktree', message: 'It has uncommitted changes.' }),
    )
    await expect(run()).resolves.toMatchObject({
      ok: false,
      message: 'Archived 1 Session, but the worktree was kept: It has uncommitted changes.',
    })
  })

  it("removes Git's registered folder, however the request spelled it", async () => {
    mocks.usage.mockReturnValue(usage())
    await expect(run(`${WORKTREE}/`)).resolves.toEqual({ ok: true })
    // Its force overrides only the lock: uncommitted changes still keep the worktree.
    expect(mocks.remove).toHaveBeenCalledWith(PROJECT, {
      path: WORKTREE,
      force: true,
      lockOnly: true,
    })
  })

  it('archives only, and keeps the worktree, for Archive Sessions', async () => {
    mocks.usage.mockReturnValue(usage())
    await expect(run(WORKTREE, ['open', 'done'], { keepWorktree: true })).resolves.toEqual({
      ok: true,
      path: WORKTREE,
      message: 'Archived 1 Session. The worktree is kept.',
    })
    expect(mocks.dispatch).toHaveBeenCalledOnce()
    expect(mocks.remove).not.toHaveBeenCalled()

    // Archived meanwhile from elsewhere: nothing left to archive, and it says so.
    mocks.usage.mockReturnValue(
      usage({
        sessions: [
          {
            sessionId: 'done',
            title: 'Done',
            archived: true,
            archivedAt: 5,
            running: false,
            owner: true,
          },
        ],
      }),
    )
    await expect(run(WORKTREE, ['done'], { keepWorktree: true })).resolves.toMatchObject({
      message: 'Its Sessions were already archived. The worktree is kept.',
    })
  })

  it('refuses a folder that is not a registered linked worktree', async () => {
    await expect(run(PROJECT)).rejects.toThrow(/no longer registered/)
    await expect(run('/elsewhere')).rejects.toThrow(/no longer registered/)
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('stops before removing when the Host did not archive a Session', async () => {
    mocks.usage.mockReturnValue(usage())
    mocks.dispatch.mockReturnValue(
      Effect.succeed({
        contract: 'session-control-v2',
        response: { outcome: { effect: 'rejected' } },
      }),
    )
    await expect(run()).rejects.toThrow(/did not archive/)
    expect(mocks.remove).not.toHaveBeenCalled()
  })
})
