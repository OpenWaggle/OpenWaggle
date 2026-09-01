import type { SyntaxResourceCatalog, SyntaxThemeImportPreview } from './syntax-resources'
import type {
  WorkspaceExternalEditor,
  WorkspaceFileExternalOpenInput,
} from './workspace-external-editor'
import type {
  WorkspaceContentMatch,
  WorkspaceDocumentApplyInput,
  WorkspaceDocumentApplyResult,
  WorkspaceEntryCreateInput,
  WorkspaceEntryMutationInput,
  WorkspaceEntryMutationResult,
  WorkspaceFileEntry,
  WorkspaceFilePage,
  WorkspaceFileReadResult,
  WorkspaceFilesChangedEvent,
  WorkspaceFileWriteInput,
  WorkspaceFileWriteResult,
  WorkspaceTextEncoding,
} from './workspace-files'

export interface OpenWaggleWorkspaceFilesApi {
  listSyntaxThemes(projectPath?: string | null): Promise<SyntaxResourceCatalog>
  selectSyntaxThemeImport(): Promise<SyntaxThemeImportPreview | null>
  applySyntaxThemeImport(token: string): Promise<SyntaxResourceCatalog>
  removeSyntaxTheme(themeId: string): Promise<SyntaxResourceCatalog>
  searchWorkspaceFiles(
    projectPath: string,
    query: string,
    limit: number,
  ): Promise<WorkspaceFileEntry[]>
  searchWorkspaceContent(
    projectPath: string,
    query: string,
    limit: number,
  ): Promise<WorkspaceContentMatch[]>
  cancelWorkspaceContentSearch(projectPath: string): Promise<void>
  readWorkspaceFile(projectPath: string, path: string): Promise<WorkspaceFileReadResult>
  readWorkspaceFileWithEncoding(
    projectPath: string,
    path: string,
    encoding: WorkspaceTextEncoding,
  ): Promise<WorkspaceFileReadResult>
  writeWorkspaceFile(input: WorkspaceFileWriteInput): Promise<WorkspaceFileWriteResult>
  applyWorkspaceDocumentEdits(
    input: WorkspaceDocumentApplyInput,
  ): Promise<WorkspaceDocumentApplyResult>
  listWorkspaceExternalEditors(): Promise<WorkspaceExternalEditor[]>
  openWorkspaceFileExternal(input: WorkspaceFileExternalOpenInput): Promise<void>
  createWorkspaceEntry(input: WorkspaceEntryCreateInput): Promise<WorkspaceEntryMutationResult>
  moveWorkspaceEntry(input: WorkspaceEntryMutationInput): Promise<WorkspaceEntryMutationResult>
  duplicateWorkspaceEntry(input: WorkspaceEntryMutationInput): Promise<WorkspaceEntryMutationResult>
  trashWorkspaceEntry(input: WorkspaceEntryMutationInput): Promise<WorkspaceEntryMutationResult>
  revealWorkspaceEntry(projectPath: string, path: string): Promise<void>
  watchWorkspaceFiles(projectPath: string): Promise<string>
  unwatchWorkspaceFiles(projectPath: string): Promise<void>
  onWorkspaceFilesChanged(callback: (payload: WorkspaceFilesChangedEvent) => void): () => void
  readWorkspaceFilePage(
    projectPath: string,
    path: string,
    offset: number,
    limit: number,
  ): Promise<WorkspaceFilePage>
}
