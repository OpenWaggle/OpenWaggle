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
}

export interface WorkspaceBinaryFileReadResult extends WorkspaceFileReadBase {
  readonly previewKind: 'image' | 'pdf'
  readonly data: Uint8Array
}

export interface WorkspaceUnavailableFileReadResult extends WorkspaceFileReadBase {
  readonly previewKind: 'binary' | 'oversized'
  readonly reason: string
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
