import type {
  WorkspaceContentMatch,
  WorkspaceFileEntry,
  WorkspaceFileReadResult,
  WorkspaceFileWriteInput,
  WorkspaceFileWriteResult,
} from './workspace-files'

export interface IpcWorkspaceFileInvokeChannelMap {
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
  'workspace-files:write': {
    args: [input: WorkspaceFileWriteInput]
    return: WorkspaceFileWriteResult
  }
  'workspace-files:open-external': {
    args: [projectPath: string, path: string]
    return: undefined
  }
}
