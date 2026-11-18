/**
 * Renderer-facing authorization grant API.
 *
 * Split out of `openwaggle-api.ts`, which is at its line limit, and kept together because these
 * three calls are the whole surface Settings needs to show and revoke what a project has granted.
 */
import type { IpcInvokeMethod } from './ipc-api-methods'

export interface OpenWaggleAuthorizationGrantApi {
  /** Every persistent grant recorded for a project. */
  listAuthorizationGrants: IpcInvokeMethod<'authorization-grants:list'>
  /** Records a persistent grant, replacing any existing grant for the same key. */
  grantAuthorization: IpcInvokeMethod<'authorization-grants:grant'>
  /** Removes a persistent grant. Applies from the next request, never retroactively. */
  revokeAuthorization: IpcInvokeMethod<'authorization-grants:revoke'>
}
