import { registerSessionCatalogHandlers } from './session-catalog-handler'
import { hostHandle } from './typed-ipc'

export function registerSessionsHandlers(): void {
  registerSessionCatalogHandlers()
  hostHandle('sessions:list-archived-branches')
  hostHandle('sessions:query-archived-items')
  hostHandle('sessions:list-archived-item-refs')
  hostHandle('sessions:set-archived-items')
  hostHandle('sessions:delete-archived-sessions')
  hostHandle('sessions:get-tree')
  hostHandle('sessions:get-workspace')
  hostHandle('sessions:navigate-tree')
  hostHandle('sessions:rename-branch')
  hostHandle('sessions:archive-branch')
  hostHandle('sessions:restore-branch')
  hostHandle('sessions:update-tree-ui-state')
}
