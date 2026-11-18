import { hostHandle } from './typed-ipc'

export function registerSessionResourceCatalogHandlers() {
  hostHandle('sessions:resources:page')
  hostHandle('sessions:resources:get')
  hostHandle('sessions:resources:locate-image')
  hostHandle('sessions:resources:node-page')
  hostHandle('sessions:resources:list-by-node-ids')
}
