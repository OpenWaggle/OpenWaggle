import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import * as Effect from 'effect/Effect'
import { WorkspaceProjectAuthorization } from '../ports/workspace-project-authorization'
import { validateAuthorizedProjectPath } from '../utils/project-path-validation'

const projectPathSchema = Schema.String.pipe(Schema.minLength(1))

/** The Host evaluates its own roots. It never trusts the GUI's isolated database. */
export function authorizeHostUiWorkspaceProject(input: unknown) {
  return Effect.gen(function* () {
    const projectPath = decodeUnknownOrThrow(projectPathSchema, input)
    return yield* (yield* WorkspaceProjectAuthorization).authorize(projectPath)
  })
}

export function authorizeWorkspaceProject(projectPath: string) {
  return Effect.gen(function* () {
    const remote = yield* Effect.tryPromise({
      try: async () => {
        const { invokeConfiguredHostUi } = await import('./gui-session-command-router')
        return invokeConfiguredHostUi('workspace-files:authorize-project', [projectPath])
      },
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    })
    if (!remote.handled) return yield* authorizeHostUiWorkspaceProject(projectPath)
    const authorizedPath = decodeUnknownOrThrow(projectPathSchema, remote.result)
    return yield* validateAuthorizedProjectPath(projectPath, [authorizedPath])
  })
}
