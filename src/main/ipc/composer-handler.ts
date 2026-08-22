import { COMPOSER } from '@shared/constants/resource-limits'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import * as Effect from 'effect/Effect'
import { WorkspaceFileService } from '../ports/workspace-file-service'
import { validateRequiredProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

const projectPathSchema = Schema.String.pipe(Schema.minLength(1))

export function registerComposerHandlers(): void {
  typedHandle('composer:file-suggest', (_event, rawProjectPath: string, query: string) =>
    Effect.gen(function* () {
      const projectPath = yield* validateRequiredProjectPath(
        decodeUnknownOrThrow(projectPathSchema, rawProjectPath),
      )

      const workspaceFiles = yield* WorkspaceFileService
      const entries = yield* workspaceFiles.searchFiles({
        projectPath,
        query,
        limit: COMPOSER.FILE_SUGGEST_LIMIT,
      })
      return entries.map((entry) => ({ ...entry, isDirectory: false }))
    }),
  )
}
