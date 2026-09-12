import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { WorkspaceProjectAuthorization } from '../ports/workspace-project-authorization'
import {
  validateAuthorizedProjectPath,
  validateRequiredProjectPath,
} from '../utils/project-path-validation'

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
  }),
)
