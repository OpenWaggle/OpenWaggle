import type { SyntaxResourceCatalog, SyntaxThemeImportPreview } from './syntax-resources'
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
  WorkspaceFileWriteInput,
  WorkspaceFileWriteResult,
  WorkspaceTextEncoding,
} from './workspace-files'

export interface IpcWorkspaceFileInvokeChannelMap {
  'syntax-themes:list': {
    args: [projectPath?: string | null]
    return: SyntaxResourceCatalog
  }
  'syntax-themes:select-import': {
    args: []
    return: SyntaxThemeImportPreview | null
  }
  'syntax-themes:apply-import': {
    args: [token: string]
    return: SyntaxResourceCatalog
  }
  'syntax-themes:remove': {
    args: [themeId: string]
    return: SyntaxResourceCatalog
  }
  'workspace-files:search': {
    args: [projectPath: string, query: string, limit: number]
    return: WorkspaceFileEntry[]
  }
  'workspace-files:search-content': {
    args: [projectPath: string, query: string, limit: number]
    return: WorkspaceContentMatch[]
  }
  'workspace-files:cancel-content-search': {
    args: [projectPath: string]
    return: undefined
  }
  'workspace-files:read': {
    args: [projectPath: string, path: string]
    return: WorkspaceFileReadResult
  }
  'workspace-files:read-with-encoding': {
    args: [projectPath: string, path: string, encoding: WorkspaceTextEncoding]
    return: WorkspaceFileReadResult
  }
  'workspace-files:write': {
    args: [input: WorkspaceFileWriteInput]
    return: WorkspaceFileWriteResult
  }
  'workspace-files:apply-document-edits': {
    args: [input: WorkspaceDocumentApplyInput]
    return: WorkspaceDocumentApplyResult
  }
  'workspace-files:open-external': {
    args: [projectPath: string, path: string]
    return: undefined
  }
  'workspace-files:create-entry': {
    args: [input: WorkspaceEntryCreateInput]
    return: WorkspaceEntryMutationResult
  }
  'workspace-files:move-entry': {
    args: [input: WorkspaceEntryMutationInput]
    return: WorkspaceEntryMutationResult
  }
  'workspace-files:duplicate-entry': {
    args: [input: WorkspaceEntryMutationInput]
    return: WorkspaceEntryMutationResult
  }
  'workspace-files:trash-entry': {
    args: [input: WorkspaceEntryMutationInput]
    return: WorkspaceEntryMutationResult
  }
  'workspace-files:reveal-entry': {
    args: [projectPath: string, path: string]
    return: undefined
  }
  'workspace-files:watch': {
    args: [projectPath: string]
    return: string
  }
  'workspace-files:unwatch': {
    args: [projectPath: string]
    return: undefined
  }
  'workspace-files:read-page': {
    args: [projectPath: string, path: string, offset: number, limit: number]
    return: WorkspaceFilePage
  }
}
