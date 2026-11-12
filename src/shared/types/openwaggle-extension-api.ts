import type { IpcInvokeMethod } from './ipc-api-methods'

export interface OpenWaggleExtensionApi {
  listExtensionPackages: IpcInvokeMethod<'extensions:list-packages'>
  listExtensionContributions: IpcInvokeMethod<'extensions:list-contributions'>
  proposeExtensionPackageWrite: IpcInvokeMethod<'extensions:propose-package-write'>
  applyExtensionPackageWrite: IpcInvokeMethod<'extensions:apply-package-write'>
  proposeExtensionPackageRemove: IpcInvokeMethod<'extensions:propose-package-remove'>
  applyExtensionPackageRemove: IpcInvokeMethod<'extensions:apply-package-remove'>
  invokeExtension: IpcInvokeMethod<'extensions:invoke'>
  registerExtensionFrame: IpcInvokeMethod<'extensions:register-frame'>
  unregisterExtensionFrame: IpcInvokeMethod<'extensions:unregister-frame'>
  setExtensionTrusted: IpcInvokeMethod<'extensions:set-trusted'>
  setExtensionEnabled: IpcInvokeMethod<'extensions:set-enabled'>
  setExtensionProjectDisabled: IpcInvokeMethod<'extensions:set-project-disabled'>
  acceptExtensionUpdate: IpcInvokeMethod<'extensions:accept-update'>
  approveExtensionBuild: IpcInvokeMethod<'extensions:approve-build'>
  reloadExtension: IpcInvokeMethod<'extensions:reload'>
}
