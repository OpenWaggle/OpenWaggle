/**
 * Renderer-facing project configuration API.
 *
 * Split out of `openwaggle-api.ts`, which is at its line limit. Grouped because the payload shapes
 * and the two calls that use them only make sense together: reading a project's overrides, and
 * writing them where `null` clears a key.
 */

import type { AgentAuthorizationMode } from './agent-authorization'
import type { IpcEventMethod, IpcInvokeMethod } from './ipc-api-methods'

/** Wire shape of the per-project agent overrides carried over IPC. */
export interface ProjectPreferencesPayload {
  model?: string
  authorizationMode?: AgentAuthorizationMode
}

/**
 * A preference write.
 *
 * `undefined` leaves a key alone. `null` deletes it, which is how a project override is cleared so
 * the project inherits the global default again.
 */
export interface ProjectPreferencesUpdatePayload {
  model?: string | null
  authorizationMode?: AgentAuthorizationMode | null
}

export interface OpenWaggleProjectConfigApi {
  manageProjectActions: IpcInvokeMethod<'project-actions:manage'>
  selectProjectFolder: IpcInvokeMethod<'project:select-folder'>
  /** Consume the project an `openwaggle <path>` launch asked to open, if any. */
  takeOpenProjectRequest: IpcInvokeMethod<'project:take-open-request'>
  onOpenProjectRequested: IpcEventMethod<'app:open-project-requested'>
  /** Consume the Session identity of the oldest opened Session link, if any (ADR 0056). */
  takeOpenSessionLinkRequest: IpcInvokeMethod<'app:take-open-session-link-request'>
  onOpenSessionLinkRequested: IpcEventMethod<'app:open-session-link-requested'>
  getProjectPreferences: IpcInvokeMethod<'project-config:get-preferences'>
  /** Resolves to the canonical (realpath) project path the write was stored under. */
  setProjectPreferences: IpcInvokeMethod<'project-config:set-preferences'>
  /** Deletes a removed project's stored model entry; resolves to the canonical path removed. The remaining project references let the backend keep the entry while an equivalent reference survives. */
  removeProjectModel: IpcInvokeMethod<'project-config:remove-project-model'>
}
