/**
 * The request objects the window passes to the `workspace-files:*` IPC channels. Each schema is
 * the one source of its payload: `@shared/types/workspace-files` and
 * `@shared/types/workspace-external-editor` export the inferred types, and the main handler
 * decodes with these schemas.
 */
import { WORKSPACE_FILES } from '@shared/constants/resource-limits'
import { WORKSPACE_EDITOR_PERFORMANCE } from '@shared/constants/workspace-editor-performance'
import { Schema } from '@shared/schema'
import { WORKSPACE_EXTERNAL_EDITOR_DEFINITIONS } from '@shared/types/workspace-external-editor'
import { WORKSPACE_TEXT_ENCODINGS } from '@shared/types/workspace-files'

export const workspaceNonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1))
const nonNegativeIntegerSchema = Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0))
const filePositionSchema = Schema.Number.pipe(Schema.int(), Schema.greaterThan(0))
const focusedEditTextSchema = Schema.String.pipe(
  Schema.maxLength(WORKSPACE_EDITOR_PERFORMANCE.FOCUSED_EDIT_MAX_BYTES),
)

export const workspaceFileWriteInputSchema = Schema.Struct({
  projectPath: workspaceNonEmptyStringSchema,
  path: workspaceNonEmptyStringSchema,
  content: focusedEditTextSchema,
  expectedRevision: workspaceNonEmptyStringSchema,
})

export const workspaceDocumentChangeSchema = Schema.Struct({
  rangeOffset: nonNegativeIntegerSchema,
  rangeLength: nonNegativeIntegerSchema,
  text: focusedEditTextSchema,
})

export const workspaceDocumentEditBatchSchema = Schema.Struct({
  version: nonNegativeIntegerSchema,
  changes: Schema.Array(workspaceDocumentChangeSchema).pipe(
    Schema.maxItems(WORKSPACE_FILES.DOCUMENT_EDIT_CHANGES_PER_BATCH_LIMIT),
  ),
})

export const workspaceDocumentApplyInputSchema = Schema.Struct({
  projectPath: workspaceNonEmptyStringSchema,
  path: workspaceNonEmptyStringSchema,
  expectedRevision: workspaceNonEmptyStringSchema,
  baseVersion: nonNegativeIntegerSchema,
  batches: Schema.Array(workspaceDocumentEditBatchSchema).pipe(
    Schema.maxItems(WORKSPACE_FILES.DOCUMENT_EDIT_BATCH_LIMIT),
  ),
  normalizeLineEnding: Schema.optional(Schema.Literal('lf', 'crlf')),
  targetEncoding: Schema.optional(Schema.Literal(...WORKSPACE_TEXT_ENCODINGS)),
})

export const workspaceEntryCreateInputSchema = Schema.Struct({
  projectPath: workspaceNonEmptyStringSchema,
  path: workspaceNonEmptyStringSchema,
  kind: Schema.Literal('file', 'directory'),
})

export const workspaceEntryMutationInputSchema = Schema.Struct({
  projectPath: workspaceNonEmptyStringSchema,
  path: workspaceNonEmptyStringSchema,
  targetPath: Schema.optional(workspaceNonEmptyStringSchema),
  overwrite: Schema.optional(Schema.Boolean),
})

const externalEditorIdSchema = Schema.Literal(
  ...WORKSPACE_EXTERNAL_EDITOR_DEFINITIONS.map((editor) => editor.id),
)

export const workspaceAbsoluteFileExternalOpenInputSchema = Schema.Struct({
  path: workspaceNonEmptyStringSchema,
  editor: externalEditorIdSchema,
  line: Schema.optional(filePositionSchema),
  column: Schema.optional(filePositionSchema),
})

export const workspaceFileExternalOpenInputSchema = Schema.Struct({
  projectPath: workspaceNonEmptyStringSchema,
  ...workspaceAbsoluteFileExternalOpenInputSchema.fields,
})
