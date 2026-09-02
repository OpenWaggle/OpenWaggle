import type { IpcAuthorizationGrantInvokeChannelMap } from './ipc-invoke-authorization-grants'
import type { IpcCoreInvokeChannelMap } from './ipc-invoke-core'
import type { IpcGitInvokeChannelMap } from './ipc-invoke-git'
import type { IpcInlineVisualizationInvokeChannelMap } from './ipc-invoke-inline-visualization'
import type { IpcIntegrationInvokeChannelMap } from './ipc-invoke-integrations'
import type { IpcMcpInvokeChannelMap } from './ipc-invoke-mcp'
import type { IpcPinnedSessionInvokeChannelMap } from './ipc-invoke-pins'

export type IpcInvokeChannelMap = IpcCoreInvokeChannelMap &
  IpcIntegrationInvokeChannelMap &
  IpcGitInvokeChannelMap &
  IpcMcpInvokeChannelMap &
  IpcPinnedSessionInvokeChannelMap &
  IpcAuthorizationGrantInvokeChannelMap &
  IpcInlineVisualizationInvokeChannelMap
