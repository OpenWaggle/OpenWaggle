import type { IpcInvokeMethod } from './ipc-api-methods'

/**
 * Sessions the desktop window asks for in one catalog page, and in one `listSessionsByIds` batch
 * when it reads the Pinned sessions (the Host reads at most 100 ids per call).
 */
export const SESSION_CATALOG_PAGE_SIZE = 100

export interface OpenWaggleSessionCatalogApi {
  listSessionsByIds: IpcInvokeMethod<'sessions:list-by-ids'>
  listSessionCatalogPage: IpcInvokeMethod<'sessions:list-page'>
  listSessionProjectPage: IpcInvokeMethod<'sessions:list-projects'>
  listHiveSessionCatalogPage: IpcInvokeMethod<'sessions:list-hive-page'>
  listHiveTreeSessionCatalogPage: IpcInvokeMethod<'sessions:list-hive-tree-page'>
  queryArchivedItems: IpcInvokeMethod<'sessions:query-archived-items'>
  listArchivedItemRefs: IpcInvokeMethod<'sessions:list-archived-item-refs'>
  setArchivedItems: IpcInvokeMethod<'sessions:set-archived-items'>
  deleteArchivedSessions: IpcInvokeMethod<'sessions:delete-archived-sessions'>
}
