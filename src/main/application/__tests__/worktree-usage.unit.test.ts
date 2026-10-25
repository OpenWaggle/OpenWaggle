import type { ActionRun } from '@shared/types/action-runs'
import type { TerminalActivitySnapshot } from '@shared/types/terminal'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it, vi } from 'vitest'
import { ActionRunService } from '../../ports/action-run-service'
import { GitWorktreeService } from '../../ports/git-worktree-service'
import {
  SessionWorkspaceResourceRepository,
  type WorkspaceOccupant,
} from '../../ports/session-workspace-resource-repository'
import { TerminalService } from '../../ports/terminal-service'
import { WorkspacePreparationService } from '../../ports/workspace-preparation-service'
import { removeHostUiWorktree } from '../host-ui-worktree-operation'
import { listWorktreeUsage, previewWorktreeRemoval } from '../worktree-usage'

const PROJECT = '/repo'
const WORKTREES = {
  main: '/repo',
  active: '/wt/active',
  archived: '/wt/archived',
  archivedRunning: '/wt/archived-running',
  openedAsProject: '/wt/opened-as-project',
  action: '/wt/action',
  terminal: '/wt/terminal',
  draftTerminal: '/wt/draft-terminal',
  app: '/wt/app',
  free: '/wt/free',
} as const

function occupant(
  sessionId: string,
  overrides: Partial<WorkspaceOccupant> & { readonly workingPath?: string },
): WorkspaceOccupant {
  const { workingPath, ...rest } = overrides
  return {
    sessionId,
    title: `Session ${sessionId}`,
    archived: false,
    activeRun: false,
    sessionProjectPath: PROJECT,
    workspace: workingPath
      ? { id: `workspace-${sessionId}`, kind: 'managed-worktree', workingPath }
      : null,
    ...rest,
  }
}

const OCCUPANTS: readonly WorkspaceOccupant[] = [
  occupant('active', { workingPath: WORKTREES.active, title: 'Fix the login bug' }),
  occupant('archived', { workingPath: WORKTREES.archived, archived: true }),
  occupant('archived-running', {
    workingPath: WORKTREES.archivedRunning,
    archived: true,
    activeRun: true,
  }),
  occupant('local', {
    sessionProjectPath: WORKTREES.openedAsProject,
    workspace: { id: 'workspace-local', kind: 'local', workingPath: WORKTREES.openedAsProject },
  }),
  occupant('action', { workingPath: WORKTREES.action, archived: true }),
  occupant('terminal', { workingPath: WORKTREES.terminal, archived: true }),
]

function layer(
  options: {
    readonly snapshot?: TerminalActivitySnapshot
    readonly unpublished?: number | null
    readonly remove?: () => void
    readonly admitManagedWorktreeRemoval?: () => void
  } = {},
) {
  const snapshot = options.snapshot ?? {
    revision: 1,
    truncated: false,
    summaries: [
      fromPartial({ ownerKey: 'terminal', terminalId: 't1' }),
      fromPartial({ ownerKey: `draft:${WORKTREES.draftTerminal}`, terminalId: 't2' }),
    ],
  }
  return Layer.mergeAll(
    Layer.succeed(
      GitWorktreeService,
      fromPartial<GitWorktreeService['Type']>({
        list: () =>
          Effect.succeed({
            worktrees: Object.values(WORKTREES).map((worktreePath, index) => ({
              path: worktreePath,
              branch: `branch-${String(index)}`,
              head: 'abc',
              isMain: index === 0,
            })),
          }),
        applicationCheckout: () => Effect.succeed(WORKTREES.app),
        countUnpublishedCommits: () => Effect.succeed(options.unpublished ?? 0),
        remove: options.remove,
      }),
    ),
    Layer.succeed(
      SessionWorkspaceResourceRepository,
      fromPartial<SessionWorkspaceResourceRepository['Type']>({
        listWorkspaceOccupants: () => Effect.succeed(OCCUPANTS),
        admitManagedWorktreeRemoval: options.admitManagedWorktreeRemoval,
      }),
    ),
    Layer.succeed(
      ActionRunService,
      fromPartial<ActionRunService['Type']>({
        list: (workspaceId: string) =>
          Effect.succeed(
            workspaceId === 'workspace-action'
              ? [fromPartial<ActionRun>({ status: 'running', workspacePath: WORKTREES.action })]
              : [fromPartial<ActionRun>({ status: 'completed', workspacePath: '/elsewhere' })],
          ),
      }),
    ),
    Layer.succeed(
      TerminalService,
      fromPartial<TerminalService['Type']>({
        getActivitySnapshot: () => Effect.succeed(snapshot),
      }),
    ),
  )
}

async function usageByPath(options?: Parameters<typeof layer>[0]) {
  const usage = await Effect.runPromise(
    listWorktreeUsage(PROJECT).pipe(Effect.provide(layer(options))),
  )
  return new Map(usage.map((entry) => [entry.path, entry]))
}

function blockerKinds(usage: Awaited<ReturnType<typeof usageByPath>>, worktreePath: string) {
  return usage.get(worktreePath)?.blockers.map((blocker) => blocker.kind)
}

describe('Settings > Worktrees usage', () => {
  it('names what keeps each worktree in use and leaves the free ones removable', async () => {
    const usage = await usageByPath()

    // The Sessions of the opened project all work in its main checkout.
    expect(blockerKinds(usage, WORKTREES.main)).toEqual(['open-project', 'session', 'terminal'])
    expect(blockerKinds(usage, WORKTREES.active)).toEqual(['session'])
    expect(blockerKinds(usage, WORKTREES.archived)).toEqual([])
    expect(blockerKinds(usage, WORKTREES.archivedRunning)).toEqual(['session'])
    expect(blockerKinds(usage, WORKTREES.openedAsProject)).toEqual(['session'])
    expect(blockerKinds(usage, WORKTREES.action)).toEqual(['action'])
    expect(blockerKinds(usage, WORKTREES.terminal)).toEqual(['terminal'])
    expect(blockerKinds(usage, WORKTREES.draftTerminal)).toEqual(['terminal'])
    expect(blockerKinds(usage, WORKTREES.app)).toEqual(['app-checkout'])
    expect(blockerKinds(usage, WORKTREES.free)).toEqual([])
  })

  it('names the Session that owns a managed worktree, archived or not', async () => {
    const usage = await usageByPath()

    expect(usage.get(WORKTREES.active)?.sessions).toEqual([
      {
        sessionId: 'active',
        title: 'Fix the login bug',
        archived: false,
        running: false,
        owner: true,
      },
    ])
    expect(usage.get(WORKTREES.active)?.blockers[0]?.message).toBe(
      'The Session “Fix the login bug” works in it. Archive that Session first.',
    )
    expect(usage.get(WORKTREES.archived)?.sessions).toMatchObject([
      { sessionId: 'archived', archived: true, owner: true },
    ])
    // A local Session opened in a worktree uses it but does not own it.
    expect(usage.get(WORKTREES.openedAsProject)?.sessions).toMatchObject([
      { sessionId: 'local', owner: false },
    ])
  })

  it('blocks every worktree when the terminals cannot all be checked', async () => {
    const usage = await usageByPath({
      snapshot: { revision: 1, truncated: true, summaries: [] },
    })

    expect(blockerKinds(usage, WORKTREES.free)).toEqual(['terminal'])
    expect(blockerKinds(usage, WORKTREES.archived)).toEqual(['terminal'])
  })
})

describe('the removal confirmation preview', () => {
  it('reports the commits only this branch holds with its current usage', async () => {
    const preview = await Effect.runPromise(
      previewWorktreeRemoval(PROJECT, WORKTREES.archived).pipe(
        Effect.provide(layer({ unpublished: 3 })),
      ),
    )

    expect(preview).toMatchObject({
      usage: { path: WORKTREES.archived, blockers: [] },
      branch: 'branch-2',
      unpublishedCommitCount: 3,
    })
  })

  it('fails for a path that is not a worktree of the repository', async () => {
    await expect(
      Effect.runPromise(
        previewWorktreeRemoval(PROJECT, '/not/registered').pipe(Effect.provide(layer())),
      ),
    ).rejects.toThrow('This worktree is no longer registered.')
  })
})

describe('the Host removal gate', () => {
  it('refuses a worktree in use before reserving or removing it, even when forced', async () => {
    const remove = vi.fn()
    const admitManagedWorktreeRemoval = vi.fn()

    const result = await Effect.runPromise(
      removeHostUiWorktree(PROJECT, { path: WORKTREES.active, force: true }).pipe(
        Effect.provide(layer({ remove, admitManagedWorktreeRemoval })),
        Effect.provideService(WorkspacePreparationService, fromPartial({})),
      ),
    )

    expect(result).toEqual({
      ok: false,
      code: 'worktree-in-use',
      message:
        'This worktree is in use. The Session “Fix the login bug” works in it. Archive that Session first.',
    })
    expect(admitManagedWorktreeRemoval).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })
})
