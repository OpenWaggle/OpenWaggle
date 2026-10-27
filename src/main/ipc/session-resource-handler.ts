import { registerSessionResourceCatalogHandlers } from './session-resource-catalog-handlers'
import { registerSessionResourceImageHandlers } from './session-resource-image-handlers'
import { hostHandle } from './typed-ipc'

export { SESSION_RESOURCE_BACKFILL_PAGE_SIZE } from '../application/session-resource-backfill-page'

export function registerSessionResourceHandlers(): void {
  registerSessionResourceCatalogHandlers()
  registerSessionResourceImageHandlers()
  hostHandle('sessions:resources:list')
  hostHandle('sessions:resources:backfill')
  hostHandle('sessions:resources:retry')
  hostHandle('sessions:resources:record-change-request')
}
