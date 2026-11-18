import type { IpcEventMethod, IpcInvokeMethod } from './ipc-api-methods'

export interface OpenWaggleWorkspaceFilesApi {
  listSyntaxThemes: IpcInvokeMethod<'syntax-themes:list'>
  selectSyntaxThemeImport: IpcInvokeMethod<'syntax-themes:select-import'>
  applySyntaxThemeImport: IpcInvokeMethod<'syntax-themes:apply-import'>
  removeSyntaxTheme: IpcInvokeMethod<'syntax-themes:remove'>
  searchWorkspaceFiles: IpcInvokeMethod<'workspace-files:search'>
  searchWorkspaceContent: IpcInvokeMethod<'workspace-files:search-content'>
  cancelWorkspaceContentSearch: IpcInvokeMethod<'workspace-files:cancel-content-search'>
  readWorkspaceFile: IpcInvokeMethod<'workspace-files:read'>
  readWorkspaceFileWithEncoding: IpcInvokeMethod<'workspace-files:read-with-encoding'>
  writeWorkspaceFile: IpcInvokeMethod<'workspace-files:write'>
  applyWorkspaceDocumentEdits: IpcInvokeMethod<'workspace-files:apply-document-edits'>
  listWorkspaceExternalEditors: IpcInvokeMethod<'workspace-files:list-external-editors'>
  openWorkspaceFileExternal: IpcInvokeMethod<'workspace-files:open-external'>
  openAbsoluteFileExternal: IpcInvokeMethod<'workspace-files:open-absolute-external'>
  createWorkspaceEntry: IpcInvokeMethod<'workspace-files:create-entry'>
  moveWorkspaceEntry: IpcInvokeMethod<'workspace-files:move-entry'>
  duplicateWorkspaceEntry: IpcInvokeMethod<'workspace-files:duplicate-entry'>
  trashWorkspaceEntry: IpcInvokeMethod<'workspace-files:trash-entry'>
  revealWorkspaceEntry: IpcInvokeMethod<'workspace-files:reveal-entry'>
  watchWorkspaceFiles: IpcInvokeMethod<'workspace-files:watch'>
  unwatchWorkspaceFiles: IpcInvokeMethod<'workspace-files:unwatch'>
  onWorkspaceFilesChanged: IpcEventMethod<'workspace-files:changed'>
  readWorkspaceFilePage: IpcInvokeMethod<'workspace-files:read-page'>
}
