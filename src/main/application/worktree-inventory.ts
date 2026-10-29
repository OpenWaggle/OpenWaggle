import path from 'node:path'
import type { GitWorktreeInfo } from '@shared/types/git'
import type { Settings } from '@shared/types/settings'
import type {
  WorktreeCleanupFailure,
  WorktreeInventory,
  WorktreeInventoryEntry,
  WorktreeInventoryProject,
} from '@shared/types/worktree-inventory'
import { decideAutomaticWorktreeRemoval } from '@shared/utils/automatic-worktree-removal'
import * as Effect from 'effect/Effect'
import {
  classifyWorktree,
  type WorktreeFacts,
  worktreeArchivedAt,
} from '../domain/worktree-inventory/worktree-classification'
import { GitWorktreeService } from '../ports/git-worktree-service'
import { SessionWorkspaceResourceRepository } from '../ports/session-workspace-resource-repository'
import { managedWorktreeRoot } from '../services/git/session-worktree-path'
import { SettingsService } from '../services/settings-service'
import { listRetainedPreparation } from './retained-workspace-preparation'
import {
  createCanonicalizer,
  gatherWorktreeUsageFacts,
  isWithin,
  usageOfWorktree,
} from './worktree-usage'

/** Bounded parallel `git worktree list` reads, one per known project. */
const PROJECT_READ_CONCURRENCY = 4
/** Bounded parallel `git status` and `rev-list` reads, two per worktree. */
const WORKTREE_CHECK_CONCURRENCY = 6

interface ListedRepository {
  readonly projectPath: string
  readonly canonicalMain: string
  readonly opened: boolean
  readonly worktrees: readonly GitWorktreeInfo[]
}

interface InventoryCandidate {
  readonly repository: ListedRepository
  readonly worktree: GitWorktreeInfo
  readonly canonicalPath: string
  readonly managed: boolean
}

function knownProjectPaths(settings: Settings, managedProjects: readonly string[]) {
  const paths = [
    ...(settings.projectPath ? [settings.projectPath] : []),
    ...settings.recentProjects,
    ...Object.keys(settings.projectDisplayNames),
    ...managedProjects,
  ]
  return [...new Set(paths.map((candidate) => path.resolve(candidate)))]
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * One listing per repository: a project opened as a subfolder, or through one of its own
 * worktrees, lists the same worktrees again, so repositories are keyed by their main checkout.
 */
function listRepositories(
  projectPaths: readonly string[],
  openedProject: string | null,
  canonical: (candidate: string) => Promise<string>,
) {
  return Effect.gen(function* () {
    const gitWorktrees = yield* GitWorktreeService
    const listings = yield* Effect.forEach(
      projectPaths,
      (projectPath) =>
        gitWorktrees.list(projectPath).pipe(
          Effect.map((listed) => ({ projectPath, worktrees: listed.worktrees })),
          Effect.catchAllDefect(() => Effect.succeed({ projectPath, worktrees: [] })),
        ),
      { concurrency: PROJECT_READ_CONCURRENCY },
    )
    const openedCanonical = openedProject
      ? yield* Effect.promise(() => canonical(openedProject))
      : null
    const repositories = new Map<string, ListedRepository>()
    for (const listing of listings) {
      const main = listing.worktrees.find((worktree) => worktree.isMain)
      if (!main) continue
      const canonicalMain = yield* Effect.promise(() => canonical(main.path))
      const canonicalPaths = yield* Effect.promise(() =>
        Promise.all(listing.worktrees.map((worktree) => canonical(worktree.path))),
      )
      const opened =
        openedCanonical !== null &&
        canonicalPaths.some((worktreePath) => isWithin(openedCanonical, worktreePath))
      const known = repositories.get(canonicalMain)
      if (known) {
        if (opened && !known.opened) repositories.set(canonicalMain, { ...known, opened })
        continue
      }
      repositories.set(canonicalMain, {
        projectPath: main.path,
        canonicalMain,
        opened,
        worktrees: listing.worktrees,
      })
    }
    return [...repositories.values()]
  })
}

/**
 * Every managed worktree across projects, and every worktree of the opened project. A worktree
 * someone made outside OpenWaggle in another project is not OpenWaggle's to show (ADR 0060).
 */
function inventoryCandidates(
  repositories: readonly ListedRepository[],
  managedPaths: ReadonlySet<string>,
  canonical: (candidate: string) => Promise<string>,
) {
  return Effect.promise(async () => {
    const root = await canonical(managedWorktreeRoot())
    const candidates: InventoryCandidate[] = []
    for (const repository of repositories) {
      for (const worktree of repository.worktrees) {
        if (worktree.isMain) continue
        const canonicalPath = await canonical(worktree.path)
        const managed = managedPaths.has(canonicalPath) || isWithin(canonicalPath, root)
        if (!managed && !repository.opened) continue
        candidates.push({ repository, worktree, canonicalPath, managed })
      }
    }
    return candidates
  })
}

function readCleanupFailures(
  projectPaths: readonly string[],
  canonical: (candidate: string) => Promise<string>,
  problems: string[],
) {
  return Effect.gen(function* () {
    const failures = new Map<string, WorktreeCleanupFailure>()
    for (const projectPath of projectPaths) {
      const retained = yield* listRetainedPreparation(projectPath).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            problems.push(`Could not load cleanup recovery: ${errorMessage(error)}`)
            return null
          }),
        ),
      )
      for (const workspace of retained?.workspaces ?? []) {
        const key = yield* Effect.promise(() => canonical(workspace.path))
        const { path: _path, ...failure } = workspace
        failures.set(key, failure)
      }
    }
    return failures
  })
}

function readGitState(worktreePath: string) {
  return Effect.gen(function* () {
    const gitWorktrees = yield* GitWorktreeService
    const [uncommittedChangeCount, unpublishedCommitCount] = yield* Effect.all(
      [
        gitWorktrees.countUncommittedChanges(worktreePath),
        gitWorktrees.countUnpublishedCommits(worktreePath),
      ],
      { concurrency: 'unbounded' },
    )
    return { uncommittedChangeCount, unpublishedCommitCount }
  })
}

function projectName(settings: Settings, projectPath: string) {
  return settings.projectDisplayNames[projectPath] ?? (path.basename(projectPath) || projectPath)
}

/** Settings > Worktrees: every worktree OpenWaggle manages, classified (ADR 0060). */
export function listWorktreeInventory(now: number = Date.now()) {
  return Effect.gen(function* () {
    const settings = yield* (yield* SettingsService).get()
    const workspaces = yield* SessionWorkspaceResourceRepository
    const canonical = createCanonicalizer()
    const problems: string[] = []
    const resources = yield* workspaces.listManagedWorktreeRemovalCandidates()
    const managedPaths = new Set(
      yield* Effect.promise(() =>
        Promise.all(resources.map((resource) => canonical(resource.workingPath))),
      ),
    )
    const repositories = yield* listRepositories(
      knownProjectPaths(
        settings,
        resources.map((resource) => resource.projectPath),
      ),
      settings.projectPath,
      canonical,
    )
    const candidates = yield* inventoryCandidates(repositories, managedPaths, canonical)
    const { facts } = yield* gatherWorktreeUsageFacts(
      [],
      candidates.map((candidate) => candidate.worktree.path),
    )
    const cleanupFailures = yield* readCleanupFailures(
      [...new Set(resources.map((resource) => resource.projectPath))],
      canonical,
      problems,
    )
    const entries = yield* Effect.forEach(
      candidates,
      (candidate) =>
        Effect.gen(function* () {
          const usage = usageOfWorktree(candidate.canonicalPath, facts)
          const git = yield* readGitState(candidate.worktree.path)
          const cleanupFailure = cleanupFailures.get(candidate.canonicalPath)
          const worktreeFacts: WorktreeFacts = {
            managed: candidate.managed,
            locked: candidate.worktree.locked === true,
            sessions: usage.sessions,
            blockers: usage.blockers,
            ...git,
            cleanupFailed: cleanupFailure !== undefined,
          }
          const classified = {
            managed: candidate.managed,
            blockers: usage.blockers,
            archivedAt: worktreeArchivedAt(usage.sessions),
            ...classifyWorktree(worktreeFacts),
          }
          const entry: WorktreeInventoryEntry = {
            path: candidate.worktree.path,
            projectPath: candidate.repository.projectPath,
            branch: candidate.worktree.branch,
            sessions: usage.sessions,
            ...git,
            ...(cleanupFailure ? { cleanupFailure } : {}),
            ...classified,
            automaticRemoval: decideAutomaticWorktreeRemoval(
              classified,
              settings.automaticWorktreeRemoval,
              now,
            ),
          }
          return entry
        }),
      { concurrency: WORKTREE_CHECK_CONCURRENCY },
    )
    const projects = repositories
      .filter(
        (repository) =>
          repository.opened ||
          entries.some((entry) => entry.projectPath === repository.projectPath),
      )
      .map(
        (repository): WorktreeInventoryProject => ({
          projectPath: repository.projectPath,
          name: projectName(settings, repository.projectPath),
          opened: repository.opened,
        }),
      )
    return { projects, entries, problems } satisfies WorktreeInventory
  })
}
