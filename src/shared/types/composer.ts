import type { WorkspaceFileEntry } from './workspace-files'

export interface FileSuggestion extends WorkspaceFileEntry {
  readonly isDirectory: boolean
}
