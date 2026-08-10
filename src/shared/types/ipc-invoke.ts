import type { IpcCoreInvokeChannelMap } from './ipc-invoke-core'
import type { IpcGitInvokeChannelMap } from './ipc-invoke-git'
import type { IpcIntegrationInvokeChannelMap } from './ipc-invoke-integrations'

export type IpcInvokeChannelMap = IpcCoreInvokeChannelMap &
  IpcIntegrationInvokeChannelMap &
  IpcGitInvokeChannelMap
