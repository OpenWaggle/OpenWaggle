import * as Effect from 'effect/Effect'
import { listExtensionPackagesView } from '../application/extension-manager-view-service'
import { validateProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

function decodeProjectPathArg(value: unknown) {
  if (typeof value === 'string' || value === null || value === undefined) {
    return Effect.succeed(value)
  }

  return Effect.fail(new Error('Project path must be a string, null, or undefined.'))
}

export function registerExtensionsHandlers(): void {
  typedHandle('extensions:list-packages', (_event, projectPath?: string | null) =>
    Effect.gen(function* () {
      const decodedProjectPath = yield* decodeProjectPathArg(projectPath)
      const validatedProjectPath = yield* validateProjectPath(decodedProjectPath)
      return yield* listExtensionPackagesView(validatedProjectPath ?? null)
    }),
  )
}
