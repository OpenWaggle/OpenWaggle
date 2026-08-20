import type {
  WorkspaceContentMatch,
  WorkspaceFileEntry,
  WorkspaceFileReadResult,
  WorkspaceFileWriteInput,
  WorkspaceFileWriteResult,
} from './workspace-files'

export interface OpenWaggleWorkspaceFilesApi {
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
  writeWorkspaceFile(input: WorkspaceFileWriteInput): Promise<WorkspaceFileWriteResult>
  openWorkspaceFileExternal(projectPath: string, path: string): Promise<void>
}
