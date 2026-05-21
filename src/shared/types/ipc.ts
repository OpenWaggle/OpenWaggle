import type { IpcEventChannelMap, IpcSendChannelMap } from './ipc-events'
import type { IpcInvokeChannelMap } from './ipc-invoke'

export type { IpcEventChannelMap, IpcSendChannelMap } from './ipc-events'
export type { IpcInvokeChannelMap } from './ipc-invoke'
export type { OpenWaggleApi } from './openwaggle-api'

export type IpcInvokeChannel = keyof IpcInvokeChannelMap
export type IpcSendChannel = keyof IpcSendChannelMap
export type IpcEventChannel = keyof IpcEventChannelMap

export type IpcInvokeArgs<C extends IpcInvokeChannel> = IpcInvokeChannelMap[C]['args']
export type IpcInvokeReturn<C extends IpcInvokeChannel> = IpcInvokeChannelMap[C]['return']
export type IpcSendArgs<C extends IpcSendChannel> = IpcSendChannelMap[C]['args']
export type IpcEventPayload<C extends IpcEventChannel> = IpcEventChannelMap[C]['payload']
