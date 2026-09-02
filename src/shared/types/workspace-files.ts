export const WORKSPACE_FILE_PREVIEW_KINDS = [
  'text',
  'markdown',
  'html',
  'image',
  'pdf',
  'binary',
  'oversized',
] as const

export type WorkspaceFilePreviewKind = (typeof WORKSPACE_FILE_PREVIEW_KINDS)[number]

export const WORKSPACE_TEXT_ENCODINGS = ['utf-8', 'utf-8-bom', 'utf-16le', 'utf-16be'] as const
export type WorkspaceTextEncoding = (typeof WORKSPACE_TEXT_ENCODINGS)[number]
export type WorkspaceLineEnding = 'lf' | 'crlf' | 'mixed' | 'none'

export interface WorkspaceEditorConfigPolicy {
  readonly encoding?: WorkspaceTextEncoding
  readonly lineEnding?: 'lf' | 'crlf'
  readonly finalNewline?: boolean
  readonly trimTrailingWhitespace?: boolean
}

export interface WorkspaceTextFidelity {
  readonly encoding: WorkspaceTextEncoding
  readonly lineEnding: WorkspaceLineEnding
  readonly finalNewline: boolean
  readonly indentStyle: 'space' | 'tab'
  readonly indentSize: number
  readonly editorConfigApplied: boolean
  readonly editorConfigPolicy?: WorkspaceEditorConfigPolicy
}

export interface WorkspaceFileEntry {
  readonly path: string
  readonly basename: string
}

export interface WorkspaceContentMatch {
  readonly path: string
  readonly basename: string
  readonly lineNumber: number
  readonly lineText: string
  readonly matchStart: number
  readonly matchLength: number
}

interface WorkspaceFileReadBase {
  readonly path: string
  readonly basename: string
  readonly size: number
  readonly modifiedAt: number
  readonly revision: string
  readonly mimeType: string
  readonly previewKind: WorkspaceFilePreviewKind
}

export interface WorkspaceTextFileReadResult extends WorkspaceFileReadBase {
  readonly previewKind: 'text' | 'markdown' | 'html'
  readonly content: string
  readonly language?: string
  readonly documentVersion: number
  readonly fidelity: WorkspaceTextFidelity
}

export interface WorkspaceBinaryFileReadResult extends WorkspaceFileReadBase {
  readonly previewKind: 'image' | 'pdf'
  readonly data: Uint8Array
}

export interface WorkspaceUnavailableFileReadResult extends WorkspaceFileReadBase {
  readonly previewKind: 'binary' | 'oversized'
  readonly reason: string
  readonly language?: string
}

export type WorkspaceFileReadResult =
  | WorkspaceTextFileReadResult
  | WorkspaceBinaryFileReadResult
  | WorkspaceUnavailableFileReadResult

export interface WorkspaceFileWriteInput {
  readonly projectPath: string
  readonly path: string
  readonly content: string
  readonly expectedRevision: string
}

export interface WorkspaceFileWriteSavedResult {
  readonly status: 'saved'
  readonly size: number
  readonly modifiedAt: number
  readonly revision: string
}

export interface WorkspaceFileWriteConflictResult {
  readonly status: 'conflict'
  readonly message: string
}

export interface WorkspaceFileWriteTooLargeResult {
  readonly status: 'too-large'
  readonly message: string
}

export type WorkspaceFileWriteResult =
  | WorkspaceFileWriteSavedResult
  | WorkspaceFileWriteConflictResult
  | WorkspaceFileWriteTooLargeResult

export interface WorkspaceDocumentChange {
  readonly rangeOffset: number
  readonly rangeLength: number
  readonly text: string
}

export interface WorkspaceDocumentEditBatch {
  readonly version: number
  readonly changes: readonly WorkspaceDocumentChange[]
}

export interface WorkspaceDocumentApplyInput {
  readonly projectPath: string
  readonly path: string
  readonly expectedRevision: string
  readonly baseVersion: number
  readonly batches: readonly WorkspaceDocumentEditBatch[]
  readonly normalizeLineEnding?: 'lf' | 'crlf'
  readonly targetEncoding?: WorkspaceTextEncoding
}

export interface WorkspaceDocumentSavedResult {
  readonly status: 'saved'
  readonly version: number
  readonly size: number
  readonly modifiedAt: number
  readonly revision: string
  readonly encoding: WorkspaceTextEncoding
  readonly lineEnding: WorkspaceLineEnding
}

export interface WorkspaceDocumentConflictResult {
  readonly status: 'conflict'
  readonly message: string
}

export interface WorkspaceDocumentOutOfSyncResult {
  readonly status: 'out-of-sync'
  readonly message: string
  readonly expectedVersion: number
}

export interface WorkspaceDocumentTooLargeResult {
  readonly status: 'too-large'
  readonly message: string
}

export type WorkspaceDocumentApplyResult =
  | WorkspaceDocumentSavedResult
  | WorkspaceDocumentConflictResult
  | WorkspaceDocumentOutOfSyncResult
  | WorkspaceDocumentTooLargeResult

export interface WorkspaceEntryMutationInput {
  readonly projectPath: string
  readonly path: string
  readonly targetPath?: string
  readonly overwrite?: boolean
}

export interface WorkspaceEntryMutationResult {
  readonly path: string
  readonly previousPath?: string
}

export interface WorkspaceEntryCreateInput {
  readonly projectPath: string
  readonly path: string
  readonly kind: 'file' | 'directory'
}

export interface WorkspaceFilesChangedEvent {
  readonly workingPath: string
  readonly paths: readonly string[]
  readonly overflow: boolean
}

export interface WorkspaceFilePage {
  readonly path: string
  readonly size: number
  readonly offset: number
  readonly endOffset: number
  readonly nextOffset: number | null
  readonly content: string
  readonly encoding: WorkspaceTextEncoding
  readonly language?: string
}
