import type { IpcEventMethod, IpcInvokeMethod, IpcSendMethod } from './ipc-api-methods'

export interface OpenWaggleSessionResourceApi {
  activateSessionResourceOwner: IpcSendMethod<'sessions:resources:activate-owner'>
  onSessionResourcesInvalidated: IpcEventMethod<'sessions:resources-invalidated'>
  listSessionResources: IpcInvokeMethod<'sessions:resources:list'>
  listSessionResourcePage: IpcInvokeMethod<'sessions:resources:page'>
  getSessionResource: IpcInvokeMethod<'sessions:resources:get'>
  locateSessionResourceImage: IpcInvokeMethod<'sessions:resources:locate-image'>
  listSessionResourceNodePage: IpcInvokeMethod<'sessions:resources:node-page'>
  listSessionResourcesByNodeIds: IpcInvokeMethod<'sessions:resources:list-by-node-ids'>
  advanceSessionResourceBackfill: IpcInvokeMethod<'sessions:resources:backfill'>
  readSessionResource: IpcInvokeMethod<'sessions:resources:read'>
  readSessionResourceThumbnail: IpcInvokeMethod<'sessions:resources:thumbnail'>
  copySessionResourceImage: IpcInvokeMethod<'sessions:resources:copy-image'>
  prepareSessionResourceAttachment: IpcInvokeMethod<'sessions:resources:prepare-attachment'>
  retrySessionResource: IpcInvokeMethod<'sessions:resources:retry'>
  recordSessionChangeRequest: IpcInvokeMethod<'sessions:resources:record-change-request'>
}
