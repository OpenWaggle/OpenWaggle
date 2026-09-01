import { WORKSPACE_FILES } from '@shared/constants/resource-limits'
import { WORKSPACE_EDITOR_PERFORMANCE } from '@shared/constants/workspace-editor-performance'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { WORKSPACE_EXTERNAL_EDITOR_DEFINITIONS } from '@shared/types/workspace-external-editor'
import * as Effect from 'effect/Effect'
import { unwatchWorkspaceFiles, watchWorkspaceFiles } from '../adapters/workspace-file-watcher'
import { WorkspaceFileService } from '../ports/workspace-file-service'
import { WorkspaceProjectAuthorization } from '../ports/workspace-project-authorization'
import { invalidateGitStatusCache } from './git/status-cache'
import { typedHandle } from './typed-ipc'

const nonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))
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
const writeInputSchema = Schema.Struct({
  projectPath: nonEmptyStringSchema,
  path: nonEmptyStringSchema,
  content: Schema.String.pipe(
    Schema.maxLength(WORKSPACE_EDITOR_PERFORMANCE.FOCUSED_EDIT_MAX_BYTES),
  ),
  expectedRevision: nonEmptyStringSchema,
})
const nonNegativeIntegerSchema = Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0))
const pageLimitSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.between(1, WORKSPACE_EDITOR_PERFORMANCE.SOURCE_PAGE_MAX_BYTES),
)
const documentChangeSchema = Schema.Struct({
  rangeOffset: nonNegativeIntegerSchema,
  rangeLength: nonNegativeIntegerSchema,
  text: Schema.String.pipe(Schema.maxLength(WORKSPACE_EDITOR_PERFORMANCE.FOCUSED_EDIT_MAX_BYTES)),
})
const documentEditBatchSchema = Schema.Struct({
  version: nonNegativeIntegerSchema,
  changes: Schema.Array(documentChangeSchema).pipe(
    Schema.maxItems(WORKSPACE_FILES.DOCUMENT_EDIT_CHANGES_PER_BATCH_LIMIT),
  ),
})
const externalEditorIdSchema = Schema.Literal(
  ...WORKSPACE_EXTERNAL_EDITOR_DEFINITIONS.map((editor) => editor.id),
)
const externalOpenInputSchema = Schema.Struct({
  projectPath: nonEmptyStringSchema,
  path: nonEmptyStringSchema,
  editor: externalEditorIdSchema,
  line: Schema.optional(nonNegativeIntegerSchema),
})

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
const documentApplyInputSchema = Schema.Struct({
  projectPath: nonEmptyStringSchema,
  path: nonEmptyStringSchema,
  expectedRevision: nonEmptyStringSchema,
  baseVersion: nonNegativeIntegerSchema,
  batches: Schema.Array(documentEditBatchSchema).pipe(
    Schema.maxItems(WORKSPACE_FILES.DOCUMENT_EDIT_BATCH_LIMIT),
  ),
  normalizeLineEnding: Schema.optional(Schema.Literal('lf', 'crlf')),
  targetEncoding: Schema.optional(Schema.Literal('utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be')),
})
const entryCreateInputSchema = Schema.Struct({
  projectPath: nonEmptyStringSchema,
  path: nonEmptyStringSchema,
  kind: Schema.Literal('file', 'directory'),
})
const entryMutationInputSchema = Schema.Struct({
  projectPath: nonEmptyStringSchema,
  path: nonEmptyStringSchema,
  targetPath: Schema.optional(nonEmptyStringSchema),
  overwrite: Schema.optional(Schema.Boolean),
})

function validatedProjectPath(rawProjectPath: string) {
  return Effect.gen(function* () {
    const authorization = yield* WorkspaceProjectAuthorization
    return yield* authorization.authorize(
      decodeUnknownOrThrow(nonEmptyStringSchema, rawProjectPath),
    )
  })
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
      const relativePath = decodeUnknownOrThrow(nonEmptyStringSchema, rawPath)
      const workspaceFiles = yield* WorkspaceFileService
      return yield* workspaceFiles.readFile({ projectPath, path: relativePath })
    }),
  )

  typedHandle(
    'workspace-files:read-with-encoding',
    (_event, rawProjectPath, rawPath, rawEncoding) =>
      Effect.gen(function* () {
        const projectPath = yield* validatedProjectPath(rawProjectPath)
        const relativePath = decodeUnknownOrThrow(nonEmptyStringSchema, rawPath)
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
      const input = decodeUnknownOrThrow(writeInputSchema, rawInput)
      const projectPath = yield* validatedProjectPath(input.projectPath)
      const workspaceFiles = yield* WorkspaceFileService
      const result = yield* workspaceFiles.writeFile({ ...input, projectPath })
      if (result.status === 'saved') invalidateGitStatusCache(projectPath)
      return result
    }),
  )

  typedHandle('workspace-files:apply-document-edits', (_event, rawInput) =>
    Effect.gen(function* () {
      const input = decodeUnknownOrThrow(documentApplyInputSchema, rawInput)
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
      const input = decodeUnknownOrThrow(externalOpenInputSchema, rawInput)
      const projectPath = yield* validatedProjectPath(input.projectPath)
      const workspaceFiles = yield* WorkspaceFileService
      yield* workspaceFiles.openFile({ ...input, projectPath })
    }),
  )

  typedHandle('workspace-files:create-entry', (_event, rawInput) =>
    Effect.gen(function* () {
      const input = decodeUnknownOrThrow(entryCreateInputSchema, rawInput)
      const projectPath = yield* validatedProjectPath(input.projectPath)
      const workspaceFiles = yield* WorkspaceFileService
      const result = yield* workspaceFiles.createEntry({ ...input, projectPath })
      invalidateGitStatusCache(projectPath)
      return result
    }),
  )

  typedHandle('workspace-files:move-entry', (_event, rawInput) =>
    Effect.gen(function* () {
      const input = decodeUnknownOrThrow(entryMutationInputSchema, rawInput)
      const projectPath = yield* validatedProjectPath(input.projectPath)
      const workspaceFiles = yield* WorkspaceFileService
      const result = yield* workspaceFiles.moveEntry({ ...input, projectPath })
      invalidateGitStatusCache(projectPath)
      return result
    }),
  )

  typedHandle('workspace-files:duplicate-entry', (_event, rawInput) =>
    Effect.gen(function* () {
      const input = decodeUnknownOrThrow(entryMutationInputSchema, rawInput)
      const projectPath = yield* validatedProjectPath(input.projectPath)
      const workspaceFiles = yield* WorkspaceFileService
      const result = yield* workspaceFiles.duplicateEntry({ ...input, projectPath })
      invalidateGitStatusCache(projectPath)
      return result
    }),
  )

  typedHandle('workspace-files:trash-entry', (_event, rawInput) =>
    Effect.gen(function* () {
      const input = decodeUnknownOrThrow(entryMutationInputSchema, rawInput)
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
      const relativePath = decodeUnknownOrThrow(nonEmptyStringSchema, rawPath)
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
      const relativePath = decodeUnknownOrThrow(nonEmptyStringSchema, rawPath)
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
