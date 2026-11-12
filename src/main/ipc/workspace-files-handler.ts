import { WORKSPACE_FILES } from '@shared/constants/resource-limits'
import { WORKSPACE_EDITOR_PERFORMANCE } from '@shared/constants/workspace-editor-performance'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import {
  workspaceAbsoluteFileExternalOpenInputSchema,
  workspaceDocumentApplyInputSchema,
  workspaceEntryCreateInputSchema,
  workspaceEntryMutationInputSchema,
  workspaceFileExternalOpenInputSchema,
  workspaceFileWriteInputSchema,
  workspaceNonEmptyStringSchema,
} from '@shared/schemas/workspace-files-requests'
import * as Effect from 'effect/Effect'
import { unwatchWorkspaceFiles, watchWorkspaceFiles } from '../adapters/workspace-file-watcher'
import { authorizeWorkspaceProject } from '../application/workspace-project-authorization'
import { WorkspaceFileService } from '../ports/workspace-file-service'
import { invalidateGitStatusCache } from './git/status-cache'
import { typedHandle } from './typed-ipc'

const MAX_WORKSPACE_QUERY_CODE_UNITS = 1_024
const workspaceQuerySchema = Schema.String.pipe(Schema.maxLength(MAX_WORKSPACE_QUERY_CODE_UNITS))
const explorerResultLimitSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.between(1, WORKSPACE_FILES.EXPLORER_RESULT_LIMIT + 1),
)
const contentResultLimitSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.between(1, WORKSPACE_FILES.CONTENT_RESULT_LIMIT),
)
const nonNegativeIntegerSchema = Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0))
const pageLimitSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.between(1, WORKSPACE_EDITOR_PERFORMANCE.SOURCE_PAGE_MAX_BYTES),
)

function assertBoundedDocumentEditWorkload(input: {
  readonly batches: readonly {
    readonly changes: readonly { readonly text: string }[]
  }[]
}) {
  let changeCount = 0
  let insertedCodeUnits = 0
  for (const batch of input.batches) {
    changeCount += batch.changes.length
    if (changeCount > WORKSPACE_FILES.DOCUMENT_EDIT_CHANGE_LIMIT) {
      throw new Error('Document edit request contains too many changes.')
    }
    for (const change of batch.changes) {
      insertedCodeUnits += change.text.length
      if (insertedCodeUnits > WORKSPACE_FILES.DOCUMENT_EDIT_INSERT_CODE_UNIT_LIMIT) {
        throw new Error('Document edit request inserts too much text.')
      }
    }
  }
}
function validatedProjectPath(rawProjectPath: string) {
  return authorizeWorkspaceProject(
    decodeUnknownOrThrow(workspaceNonEmptyStringSchema, rawProjectPath),
  )
}

function registerWorkspaceFileReadHandlers() {
  typedHandle('workspace-files:search', (_event, rawProjectPath, rawQuery, rawLimit) =>
    Effect.gen(function* () {
      const projectPath = yield* validatedProjectPath(rawProjectPath)
      const query = decodeUnknownOrThrow(workspaceQuerySchema, rawQuery)
      const limit = decodeUnknownOrThrow(explorerResultLimitSchema, rawLimit)
      const workspaceFiles = yield* WorkspaceFileService
      const results = yield* workspaceFiles.searchFiles({ projectPath, query, limit })
      return [...results]
    }),
  )

  typedHandle('workspace-files:list-external-editors', () =>
    Effect.gen(function* () {
      const workspaceFiles = yield* WorkspaceFileService
      const editors = yield* workspaceFiles.listExternalEditors()
      return [...editors]
    }),
  )

  typedHandle('workspace-files:search-content', (_event, rawProjectPath, rawQuery, rawLimit) =>
    Effect.gen(function* () {
      const projectPath = yield* validatedProjectPath(rawProjectPath)
      const query = decodeUnknownOrThrow(workspaceQuerySchema, rawQuery)
      const limit = decodeUnknownOrThrow(contentResultLimitSchema, rawLimit)
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
      const relativePath = decodeUnknownOrThrow(workspaceNonEmptyStringSchema, rawPath)
      const workspaceFiles = yield* WorkspaceFileService
      return yield* workspaceFiles.readFile({ projectPath, path: relativePath })
    }),
  )

  typedHandle(
    'workspace-files:read-with-encoding',
    (_event, rawProjectPath, rawPath, rawEncoding) =>
      Effect.gen(function* () {
        const projectPath = yield* validatedProjectPath(rawProjectPath)
        const relativePath = decodeUnknownOrThrow(workspaceNonEmptyStringSchema, rawPath)
        const encoding = decodeUnknownOrThrow(
          Schema.Literal('utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be'),
          rawEncoding,
        )
        const workspaceFiles = yield* WorkspaceFileService
        return yield* workspaceFiles.readFileWithEncoding({
          projectPath,
          path: relativePath,
          encoding,
        })
      }),
  )

  typedHandle('workspace-files:write', (_event, rawInput) =>
    Effect.gen(function* () {
      const input = decodeUnknownOrThrow(workspaceFileWriteInputSchema, rawInput)
      const projectPath = yield* validatedProjectPath(input.projectPath)
      const workspaceFiles = yield* WorkspaceFileService
      const result = yield* workspaceFiles.writeFile({ ...input, projectPath })
      if (result.status === 'saved') invalidateGitStatusCache(projectPath)
      return result
    }),
  )

  typedHandle('workspace-files:apply-document-edits', (_event, rawInput) =>
    Effect.gen(function* () {
      const input = decodeUnknownOrThrow(workspaceDocumentApplyInputSchema, rawInput)
      assertBoundedDocumentEditWorkload(input)
      const projectPath = yield* validatedProjectPath(input.projectPath)
      const workspaceFiles = yield* WorkspaceFileService
      const result = yield* workspaceFiles.applyDocumentEdits({ ...input, projectPath })
      if (result.status === 'saved') invalidateGitStatusCache(projectPath)
      return result
    }),
  )
}

function registerWorkspaceFileMutationHandlers() {
  typedHandle('workspace-files:open-external', (_event, rawInput) =>
    Effect.gen(function* () {
      const input = decodeUnknownOrThrow(workspaceFileExternalOpenInputSchema, rawInput)
      const projectPath = yield* validatedProjectPath(input.projectPath)
      const workspaceFiles = yield* WorkspaceFileService
      yield* workspaceFiles.openFile({ ...input, projectPath })
    }),
  )

  typedHandle('workspace-files:open-absolute-external', (_event, rawInput) =>
    Effect.gen(function* () {
      const input = decodeUnknownOrThrow(workspaceAbsoluteFileExternalOpenInputSchema, rawInput)
      const workspaceFiles = yield* WorkspaceFileService
      yield* workspaceFiles.openAbsoluteFile(input)
    }),
  )

  typedHandle('workspace-files:create-entry', (_event, rawInput) =>
    Effect.gen(function* () {
      const input = decodeUnknownOrThrow(workspaceEntryCreateInputSchema, rawInput)
      const projectPath = yield* validatedProjectPath(input.projectPath)
      const workspaceFiles = yield* WorkspaceFileService
      const result = yield* workspaceFiles.createEntry({ ...input, projectPath })
      invalidateGitStatusCache(projectPath)
      return result
    }),
  )

  typedHandle('workspace-files:move-entry', (_event, rawInput) =>
    Effect.gen(function* () {
      const input = decodeUnknownOrThrow(workspaceEntryMutationInputSchema, rawInput)
      const projectPath = yield* validatedProjectPath(input.projectPath)
      const workspaceFiles = yield* WorkspaceFileService
      const result = yield* workspaceFiles.moveEntry({ ...input, projectPath })
      invalidateGitStatusCache(projectPath)
      return result
    }),
  )

  typedHandle('workspace-files:duplicate-entry', (_event, rawInput) =>
    Effect.gen(function* () {
      const input = decodeUnknownOrThrow(workspaceEntryMutationInputSchema, rawInput)
      const projectPath = yield* validatedProjectPath(input.projectPath)
      const workspaceFiles = yield* WorkspaceFileService
      const result = yield* workspaceFiles.duplicateEntry({ ...input, projectPath })
      invalidateGitStatusCache(projectPath)
      return result
    }),
  )

  typedHandle('workspace-files:trash-entry', (_event, rawInput) =>
    Effect.gen(function* () {
      const input = decodeUnknownOrThrow(workspaceEntryMutationInputSchema, rawInput)
      const projectPath = yield* validatedProjectPath(input.projectPath)
      const workspaceFiles = yield* WorkspaceFileService
      const result = yield* workspaceFiles.trashEntry({ ...input, projectPath })
      invalidateGitStatusCache(projectPath)
      return result
    }),
  )

  typedHandle('workspace-files:reveal-entry', (_event, rawProjectPath, rawPath) =>
    Effect.gen(function* () {
      const projectPath = yield* validatedProjectPath(rawProjectPath)
      const relativePath = decodeUnknownOrThrow(workspaceNonEmptyStringSchema, rawPath)
      const workspaceFiles = yield* WorkspaceFileService
      yield* workspaceFiles.revealEntry({ projectPath, path: relativePath })
    }),
  )

  typedHandle('workspace-files:watch', (event, rawProjectPath) =>
    Effect.gen(function* () {
      const projectPath = yield* validatedProjectPath(rawProjectPath)
      yield* Effect.tryPromise(() => watchWorkspaceFiles(projectPath, event.sender))
      return projectPath
    }),
  )

  typedHandle('workspace-files:unwatch', (event, rawProjectPath) =>
    Effect.gen(function* () {
      const projectPath = yield* validatedProjectPath(rawProjectPath)
      yield* Effect.tryPromise(() => unwatchWorkspaceFiles(projectPath, event.sender.id))
    }),
  )

  typedHandle('workspace-files:read-page', (_event, rawProjectPath, rawPath, rawOffset, rawLimit) =>
    Effect.gen(function* () {
      const projectPath = yield* validatedProjectPath(rawProjectPath)
      const relativePath = decodeUnknownOrThrow(workspaceNonEmptyStringSchema, rawPath)
      const offset = decodeUnknownOrThrow(nonNegativeIntegerSchema, rawOffset)
      const limit = decodeUnknownOrThrow(pageLimitSchema, rawLimit)
      const workspaceFiles = yield* WorkspaceFileService
      return yield* workspaceFiles.readPage({
        projectPath,
        path: relativePath,
        offset,
        limit,
      })
    }),
  )
}

export function registerWorkspaceFileHandlers(): void {
  registerWorkspaceFileReadHandlers()
  registerWorkspaceFileMutationHandlers()
}
