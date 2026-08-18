import type { ChangeRequestCheckoutResult, ChangeRequestListResult } from './git'

/**
 * Git source-control invoke channels split out of ipc-invoke-integrations to
 * keep each channel-map module under the line cap.
 */
export interface IpcGitInvokeChannelMap {
  'git:change-request:list': {
    args: [projectPath: string]
    return: ChangeRequestListResult
  }
  'git:change-request:checkout': {
    args: [projectPath: string, reference: string]
    return: ChangeRequestCheckoutResult
  }
}
