import type { ActionManagementRequest, ActionManagementResult } from './action-management'

export interface IpcProjectActionInvokeChannelMap {
  'project-actions:manage': {
    args: [request: ActionManagementRequest]
    return: ActionManagementResult
  }
}
