import { hostHandle } from './typed-ipc'

export function registerSessionCatalogHandlers() {
  hostHandle('sessions:list-by-ids')
  hostHandle('sessions:list-page')
  hostHandle('sessions:list-projects')
  hostHandle('sessions:list-hive-page')
  hostHandle('sessions:list-hive-tree-page')
}
