import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { isActiveActionRun } from '@shared/types/action-runs'
import type {
  WorktreeRemovalBlocker,
  WorktreeRemovalPreview,
  WorktreeSessionUsage,
  WorktreeUsage,
} from '@shared/types/worktree-usage'
import * as Effect from 'effect/Effect'
import { ActionRunService } from '../ports/action-run-service'
import { GitWorktreeService } from '../ports/git-worktree-service'
import {
  SessionWorkspaceResourceRepository,
  type WorkspaceOccupant,
} from '../ports/session-workspace-resource-repository'
import { TerminalService } from '../ports/terminal-service'

/** The renderer's owner key for terminals opened before a draft Session's first send. */
const DRAFT_TERMINAL_OWNER_PREFIX = 'draft:'
/** Bounded parallel reads of each Workspace's Project Action runs. */
const ACTION_RUN_READ_CONCURRENCY = 8

interface WorktreeUsageFacts {
  readonly projectPath: string
  readonly applicationCheckout: string | null
  readonly occupants: readonly CanonicalOccupant[]
  /** Workspace paths with a starting, running or stopping Project Action. */
  readonly activeActionPaths: readonly string[]
  /** Owner keys of every terminal record; null when they could not all be read. */
  readonly terminalOwnerKeys: ReadonlySet<string> | null
}

interface CanonicalOccupant extends WorkspaceOccupant {
  readonly canonicalWorkingPath: string | null
  readonly canonicalProjectPath: string | null
}

function isWithin(candidate: string, folder: string) {
  const relative = path.relative(folder, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/** Canonical paths, so a symlinked spelling (macOS `/var` and `/private/var`) still matches. */
function createCanonicalizer() {
  const cache = new Map<string, Promise<string>>()
  return (candidate: string) => {
    const resolved = path.resolve(candidate)
    let canonical = cache.get(resolved)
    if (!canonical) {
      canonical = realpath(resolved).catch(() => resolved)
      cache.set(resolved, canonical)
    }
    return canonical
  }
}

function sessionUsesWorktree(occupant: CanonicalOccupant, worktreePath: string) {
  return (
    (occupant.canonicalWorkingPath !== null &&
      isWithin(occupant.canonicalWorkingPath, worktreePath)) ||
    (occupant.canonicalProjectPath !== null &&
      isWithin(occupant.canonicalProjectPath, worktreePath))
  )
}

function sessionUsage(occupant: CanonicalOccupant, worktreePath: string): WorktreeSessionUsage {
  return {
    sessionId: occupant.sessionId,
    title: occupant.title,
    archived: occupant.archived,
    running: occupant.activeRun,
    owner:
      occupant.workspace?.kind === 'managed-worktree' &&
      occupant.canonicalWorkingPath === worktreePath,
  }
}

function sessionBlocker(sessions: readonly WorktreeSessionUsage[]): WorktreeRemovalBlocker | null {
  const using = sessions.filter((session) => !session.archived || session.running)
  const [first] = using
  if (!first) return null
  if (using.length > 1) {
    return {
      kind: 'session',
      message: `${String(using.length)} Sessions work in it. Archive them, and stop any Run they still have, first.`,
    }
  }
  return {
    kind: 'session',
    // An archived Session only blocks while its Run goes on, so archiving is no remedy there.
    message: first.archived
      ? `The archived Session “${first.title}” still has a Run in it. Stop that Run first.`
      : `The Session “${first.title}” works in it. Archive that Session first.`,
  }
}

function terminalBlocker(
  facts: WorktreeUsageFacts,
  worktreePath: string,
  sessionIds: ReadonlySet<string>,
): WorktreeRemovalBlocker | null {
  if (facts.terminalOwnerKeys === null) {
    return {
      kind: 'terminal',
      message: 'OpenWaggle could not check every open terminal. Try again in a moment.',
    }
  }
  const open = [...facts.terminalOwnerKeys].some(
    (ownerKey) =>
      sessionIds.has(ownerKey) ||
      (ownerKey.startsWith(DRAFT_TERMINAL_OWNER_PREFIX) &&
        isWithin(path.resolve(ownerKey.slice(DRAFT_TERMINAL_OWNER_PREFIX.length)), worktreePath)),
  )
  return open
    ? { kind: 'terminal', message: 'A terminal is open in it. Close that terminal first.' }
    : null
}

/** Who uses one worktree and why it may not be removed (issue #353). Pure over `facts`. */
function usageOfWorktree(worktreePath: string, facts: WorktreeUsageFacts): WorktreeUsage {
  const occupants = facts.occupants.filter((occupant) =>
    sessionUsesWorktree(occupant, worktreePath),
  )
  const sessions = occupants.map((occupant) => sessionUsage(occupant, worktreePath))
  const blockers: WorktreeRemovalBlocker[] = []
  if (isWithin(facts.projectPath, worktreePath)) {
    blockers.push({
      kind: 'open-project',
      message: 'It is the checkout of the open project.',
    })
  }
  if (facts.applicationCheckout !== null && isWithin(facts.applicationCheckout, worktreePath)) {
    blockers.push({
      kind: 'app-checkout',
      message: 'The running OpenWaggle app was started from it.',
    })
  }
  const session = sessionBlocker(sessions)
  if (session) blockers.push(session)
  if (facts.activeActionPaths.some((workspacePath) => isWithin(workspacePath, worktreePath))) {
    blockers.push({
      kind: 'action',
      message: 'A Project Action is running in it. Stop it first.',
    })
  }
  const terminal = terminalBlocker(
    facts,
    worktreePath,
    new Set(occupants.map((occupant) => occupant.sessionId)),
  )
  if (terminal) blockers.push(terminal)
  return { path: worktreePath, sessions, blockers }
}

function readTerminalOwnerKeys() {
  return Effect.gen(function* () {
    const terminals = yield* TerminalService
    const snapshot = yield* terminals.getActivitySnapshot()
    // A truncated snapshot omits records, so it cannot prove a worktree has no terminal.
    return snapshot.truncated
      ? null
      : new Set(snapshot.summaries.map((summary) => summary.ownerKey))
  }).pipe(Effect.catchAll(() => Effect.succeed(null)))
}

function readActiveActionPaths(
  occupants: readonly CanonicalOccupant[],
  canonical: (candidate: string) => Promise<string>,
) {
  return Effect.gen(function* () {
    const actions = yield* ActionRunService
    const workspaceIds = [...new Set(occupants.flatMap((occupant) => occupant.workspace?.id ?? []))]
    const runs = yield* Effect.forEach(workspaceIds, (workspaceId) => actions.list(workspaceId), {
      concurrency: ACTION_RUN_READ_CONCURRENCY,
    })
    return yield* Effect.promise(() =>
      Promise.all(
        runs
          .flat()
          .filter(isActiveActionRun)
          .map((run) => canonical(run.workspacePath)),
      ),
    )
  })
}

function gatherFacts(projectPath: string, worktreePaths: readonly string[]) {
  return Effect.gen(function* () {
    const canonical = createCanonicalizer()
    const repository = yield* SessionWorkspaceResourceRepository
    const gitWorktrees = yield* GitWorktreeService
    const canonicalWorktrees = yield* Effect.promise(() =>
      Promise.all(worktreePaths.map((worktreePath) => canonical(worktreePath))),
    )
    const rawOccupants = yield* repository.listWorkspaceOccupants()
    const occupants = yield* Effect.promise(() =>
      Promise.all(
        rawOccupants.map(
          async (occupant): Promise<CanonicalOccupant> => ({
            ...occupant,
            canonicalWorkingPath: occupant.workspace
              ? await canonical(occupant.workspace.workingPath)
              : null,
            canonicalProjectPath: occupant.sessionProjectPath
              ? await canonical(occupant.sessionProjectPath)
              : null,
          }),
        ),
      ),
    )
    // Only Sessions in one of these worktrees can block them; the rest need no further reads.
    const relevant = occupants.filter((occupant) =>
      canonicalWorktrees.some((worktreePath) => sessionUsesWorktree(occupant, worktreePath)),
    )
    const applicationCheckout = yield* gitWorktrees.applicationCheckout()
    const facts: WorktreeUsageFacts = {
      projectPath: yield* Effect.promise(() => canonical(projectPath)),
      applicationCheckout: applicationCheckout
        ? yield* Effect.promise(() => canonical(applicationCheckout))
        : null,
      occupants: relevant,
      activeActionPaths: yield* readActiveActionPaths(relevant, canonical),
      terminalOwnerKeys: yield* readTerminalOwnerKeys(),
    }
    return { facts, canonicalWorktrees }
  })
}

/** Settings > Worktrees: each worktree's Sessions and what blocks its removal. */
export function listWorktreeUsage(projectPath: string) {
  return Effect.gen(function* () {
    const gitWorktrees = yield* GitWorktreeService
    const listed = yield* gitWorktrees.list(projectPath)
    const paths = listed.worktrees.map((worktree) => worktree.path)
    const { facts, canonicalWorktrees } = yield* gatherFacts(projectPath, paths)
    return paths.map((worktreePath, index) => ({
      ...usageOfWorktree(canonicalWorktrees[index] ?? worktreePath, facts),
      // Keep Git's spelling, which is what the renderer joins the list on.
      path: worktreePath,
    }))
  })
}

/** What blocks removing one worktree, read fresh. Empty when removal may go ahead. */
export function worktreeRemovalBlockers(projectPath: string, worktreePath: string) {
  return Effect.gen(function* () {
    const { facts, canonicalWorktrees } = yield* gatherFacts(projectPath, [worktreePath])
    return usageOfWorktree(canonicalWorktrees[0] ?? worktreePath, facts).blockers
  })
}

/** The confirmation's facts: who uses the worktree and the work only its branch holds. */
export function previewWorktreeRemoval(projectPath: string, worktreePath: string) {
  return Effect.gen(function* () {
    const gitWorktrees = yield* GitWorktreeService
    const listed = yield* gitWorktrees.list(projectPath)
    const canonical = createCanonicalizer()
    const target = yield* Effect.promise(() => canonical(worktreePath))
    const registered = yield* Effect.promise(async () => {
      for (const worktree of listed.worktrees) {
        if ((await canonical(worktree.path)) === target) return worktree
      }
      return undefined
    })
    if (!registered) return yield* Effect.fail(new Error('This worktree is no longer registered.'))
    const { facts } = yield* gatherFacts(projectPath, [registered.path])
    const usage = { ...usageOfWorktree(target, facts), path: registered.path }
    const unpublishedCommitCount = yield* gitWorktrees.countUnpublishedCommits(registered.path)
    return {
      usage,
      branch: registered.branch,
      unpublishedCommitCount,
    } satisfies WorktreeRemovalPreview
  })
}
