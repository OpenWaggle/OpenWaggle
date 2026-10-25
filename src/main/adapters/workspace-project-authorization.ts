import path from 'node:path'
import type { Settings } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { WorkspaceProjectAuthorization } from '../ports/workspace-project-authorization'
import {
  validateAuthorizedProjectPath,
  validateRequiredProjectPath,
} from '../utils/project-path-validation'

/** The folders the user opened as projects. */
export function userProjectPaths(
  settings: Pick<Settings, 'projectPath' | 'recentProjects' | 'projectDisplayNames'>,
) {
  return [
    ...(settings.projectPath ? [settings.projectPath] : []),
    ...settings.recentProjects,
    ...Object.keys(settings.projectDisplayNames),
  ]
}

export interface WorkspaceProjectSources {
  readonly userProjects: readonly string[]
  /** The project of the Session whose ready managed worktree is exactly at a path, if any. */
  readonly managedWorktreeProject: (workingPath: string) => Promise<string | null>
}

function strictAncestors(directory: string) {
  const chain: string[] = []
  let current = path.dirname(directory)
  while (true) {
    chain.push(current)
    const parent = path.dirname(current)
    if (parent === current) return chain
    current = parent
  }
}

/**
 * The project a workspace path stands for, or null when it stands for itself. `candidates` are
 * spellings of one directory (as given, then its real path). A folder the user opened as a
 * project is that project, even if it is also a worktree; a Session's ready managed worktree
 * stands for the Session's durable project, whose files a Run reads. With
 * `insideManagedWorktrees`, a directory below such a worktree stands for that project too, as a
 * Run started there sees it; the walk stops at a folder the user opened as a project. A plain
 * subdirectory of a project stands for itself, as `create` and `launch` take it.
 */
export async function projectOfWorkspacePath(
  candidates: readonly string[],
  sources: WorkspaceProjectSources,
  options: { readonly insideManagedWorktrees?: boolean } = {},
): Promise<string | null> {
  const opened = candidates.find((candidate) => sources.userProjects.includes(candidate))
  if (opened) return opened
  for (const candidate of candidates) {
    const project = await sources.managedWorktreeProject(candidate)
    if (project) return project
  }
  if (!options.insideManagedWorktrees) return null
  for (const candidate of candidates) {
    for (const ancestor of strictAncestors(candidate)) {
      if (sources.userProjects.includes(ancestor)) break
      const project = await sources.managedWorktreeProject(ancestor)
      if (project) return project
    }
  }
  return null
}

function authorizeLegacyRootAlias(
  projectPath: string,
  listPage: (afterRoot?: string) => Promise<readonly string[]>,
) {
  return Effect.gen(function* () {
    let afterRoot: string | undefined
    while (true) {
      const roots = yield* Effect.tryPromise({
        try: () => listPage(afterRoot),
        catch: (cause) =>
          new Error('Unable to verify authorized workspace project paths.', { cause }),
      })
      if (roots.length === 0) {
        return yield* Effect.fail(new Error('Project path is not authorized for workspace access.'))
      }
      const authorized = yield* validateAuthorizedProjectPath(projectPath, roots).pipe(
        Effect.catchAll(() => Effect.succeed(null)),
      )
      if (authorized) return authorized
      afterRoot = roots.at(-1)
    }
  })
}

export const WorkspaceProjectAuthorizationLive = Layer.succeed(
  WorkspaceProjectAuthorization,
  WorkspaceProjectAuthorization.of({
    authorize: (projectPath) =>
      Effect.gen(function* () {
        const [{ getSettings }, { findSessionWorkspaceRoot, listSessionWorkspaceRootPage }] =
          yield* Effect.promise(() =>
            Promise.all([
              import('../store/settings'),
              import('../store/session-details/workspace-root-authorization'),
            ]),
          )
        const settings = getSettings()
        const settingsAuthorization = yield* validateAuthorizedProjectPath(projectPath, [
          settings.projectPath,
          ...settings.recentProjects,
          ...Object.keys(settings.projectDisplayNames),
        ]).pipe(
          Effect.map((authorizedPath): string | null => authorizedPath),
          Effect.catchAll(() => Effect.succeed(null)),
        )
        if (settingsAuthorization) return settingsAuthorization
        const canonicalPath = yield* validateRequiredProjectPath(projectPath)
        const root = yield* Effect.tryPromise({
          try: () => findSessionWorkspaceRoot(projectPath, canonicalPath),
          catch: (cause) =>
            new Error('Unable to verify authorized workspace project paths.', { cause }),
        })
        if (root) return yield* validateAuthorizedProjectPath(projectPath, [root])
        return yield* authorizeLegacyRootAlias(projectPath, listSessionWorkspaceRootPage)
      }),
    projectOfWorkspace: (authorizedPath) =>
      Effect.gen(function* () {
        const [{ getSettings }, { findManagedWorktreeProjectPath }] = yield* Effect.promise(() =>
          Promise.all([
            import('../store/settings'),
            import('../store/session-details/workspace-root-authorization'),
          ]),
        )
        const project = yield* Effect.tryPromise({
          try: () =>
            projectOfWorkspacePath([authorizedPath], {
              userProjects: userProjectPaths(getSettings()),
              managedWorktreeProject: findManagedWorktreeProjectPath,
            }),
          catch: (cause) => new Error('Unable to find the project of a workspace.', { cause }),
        })
        return project ?? authorizedPath
      }),
  }),
)
