import { manageProjectActions } from '../application/action-management'
import { hostHandle } from './typed-ipc'

export function registerProjectActionHandlers(): void {
  hostHandle('project-actions:manage', (_event, request) => manageProjectActions(request))
}
