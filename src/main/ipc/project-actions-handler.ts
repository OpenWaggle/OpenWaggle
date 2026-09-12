import { dispatchHostUiProjectActionOperation } from '../application/host-ui-project-action-operations'
import { hostHandle } from './typed-ipc'

export function registerProjectActionHandlers(): void {
  hostHandle('project-actions:list', (_event, ...args) =>
    dispatchHostUiProjectActionOperation('project-actions:list', args),
  )
  hostHandle('project-actions:add', (_event, ...args) =>
    dispatchHostUiProjectActionOperation('project-actions:add', args),
  )
  hostHandle('project-actions:update', (_event, ...args) =>
    dispatchHostUiProjectActionOperation('project-actions:update', args),
  )
  hostHandle('project-actions:delete', (_event, ...args) =>
    dispatchHostUiProjectActionOperation('project-actions:delete', args),
  )
  hostHandle('project-actions:discover-t3', (_event, ...args) =>
    dispatchHostUiProjectActionOperation('project-actions:discover-t3', args),
  )
  hostHandle('project-actions:import-t3', (_event, ...args) =>
    dispatchHostUiProjectActionOperation('project-actions:import-t3', args),
  )
}
