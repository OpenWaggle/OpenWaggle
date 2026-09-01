import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { WorkspaceProjectAuthorization } from '../ports/workspace-project-authorization'
import { validateAuthorizedProjectPath } from '../utils/project-path-validation'

export const WorkspaceProjectAuthorizationLive = Layer.succeed(
  WorkspaceProjectAuthorization,
  WorkspaceProjectAuthorization.of({
    authorize: (projectPath) =>
      Effect.gen(function* () {
        const [{ getSettings }, { listSessionWorkspaceRoots }] = yield* Effect.promise(() =>
          Promise.all([import('../store/settings'), import('../store/session-details')]),
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
        const sessions = yield* Effect.tryPromise({
          try: () => listSessionWorkspaceRoots(),
          catch: (cause) =>
            new Error('Unable to verify authorized workspace project paths.', { cause }),
        })
        return yield* validateAuthorizedProjectPath(projectPath, [
          ...sessions.flatMap((session) => [session.projectPath, session.worktreePath]),
        ])
      }),
  }),
)
