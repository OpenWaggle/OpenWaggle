import { WORKSPACE_FILES } from '@shared/constants/resource-limits'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import * as Effect from 'effect/Effect'
import { WorkspaceFileService } from '../ports/workspace-file-service'
import { validateRequiredProjectPath } from './project-path-validation'
import { typedHandle } from './typed-ipc'

const nonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))
const MAX_RESULT_LIMIT = WORKSPACE_FILES.EXPLORER_RESULT_LIMIT + 1
const resultLimitSchema = Schema.Number.pipe(Schema.int(), Schema.between(1, MAX_RESULT_LIMIT))
const writeInputSchema = Schema.Struct({
  projectPath: nonEmptyStringSchema,
  path: nonEmptyStringSchema,
  content: Schema.String,
  expectedRevision: nonEmptyStringSchema,
})

function validatedProjectPath(rawProjectPath: string) {
  return validateRequiredProjectPath(decodeUnknownOrThrow(nonEmptyStringSchema, rawProjectPath))
}

export function registerWorkspaceFileHandlers(): void {
  typedHandle('workspace-files:search', (_event, rawProjectPath, query, rawLimit) =>
    Effect.gen(function* () {
      const projectPath = yield* validatedProjectPath(rawProjectPath)
      const limit = decodeUnknownOrThrow(resultLimitSchema, rawLimit)
      const workspaceFiles = yield* WorkspaceFileService
      const results = yield* workspaceFiles.searchFiles({ projectPath, query, limit })
      return [...results]
    }),
  )

  typedHandle('workspace-files:search-content', (_event, rawProjectPath, query, rawLimit) =>
    Effect.gen(function* () {
      const projectPath = yield* validatedProjectPath(rawProjectPath)
      const limit = decodeUnknownOrThrow(resultLimitSchema, rawLimit)
      const workspaceFiles = yield* WorkspaceFileService
      const results = yield* workspaceFiles.searchContent({ projectPath, query, limit })
      return [...results]
    }),
  )

  typedHandle('workspace-files:cancel-content-search', (_event, rawProjectPath) =>
    Effect.gen(function* () {
      const projectPath = yield* validatedProjectPath(rawProjectPath)
      const workspaceFiles = yield* WorkspaceFileService
      yield* workspaceFiles.cancelContentSearch({ projectPath })
    }),
  )

  typedHandle('workspace-files:read', (_event, rawProjectPath, rawPath) =>
    Effect.gen(function* () {
      const projectPath = yield* validatedProjectPath(rawProjectPath)
      const relativePath = decodeUnknownOrThrow(nonEmptyStringSchema, rawPath)
      const workspaceFiles = yield* WorkspaceFileService
      return yield* workspaceFiles.readFile({ projectPath, path: relativePath })
    }),
  )

  typedHandle('workspace-files:write', (_event, rawInput) =>
    Effect.gen(function* () {
      const input = decodeUnknownOrThrow(writeInputSchema, rawInput)
      const projectPath = yield* validatedProjectPath(input.projectPath)
      const workspaceFiles = yield* WorkspaceFileService
      return yield* workspaceFiles.writeFile({ ...input, projectPath })
    }),
  )

  typedHandle('workspace-files:open-external', (_event, rawProjectPath, rawPath) =>
    Effect.gen(function* () {
      const projectPath = yield* validatedProjectPath(rawProjectPath)
      const relativePath = decodeUnknownOrThrow(nonEmptyStringSchema, rawPath)
      const workspaceFiles = yield* WorkspaceFileService
      yield* workspaceFiles.openFile({ projectPath, path: relativePath })
    }),
  )
}
