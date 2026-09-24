/**
 * Renderer-facing project configuration API.
 *
 * Split out of `openwaggle-api.ts`, which is at its line limit. Grouped because the payload shapes
 * and the two calls that use them only make sense together: reading a project's overrides, and
 * writing them where `null` clears a key.
 */
import type { AgentAuthorizationMode } from './agent-authorization'
import type { ActionManagementRequest, ActionManagementResult } from './action-management'

/** Wire shape of the per-project agent overrides carried over IPC. */
export interface ProjectPreferencesPayload {
  model?: string
  thinkingLevel?: string
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
  thinkingLevel?: string | null
  authorizationMode?: AgentAuthorizationMode | null
}

export interface OpenWaggleProjectConfigApi {
  manageProjectActions(request: ActionManagementRequest): Promise<ActionManagementResult>
  selectProjectFolder(): Promise<string | null>
  getProjectPreferences(projectPath: string): Promise<ProjectPreferencesPayload | null>
  /** Resolves to the canonical (realpath) project path the write was stored under. */
  setProjectPreferences(
    projectPath: string,
    preferences: ProjectPreferencesUpdatePayload,
  ): Promise<string>
<<<<<<< HEAD
  /** Deletes a removed project's stored model entry; resolves to the canonical path removed. The surviving project references let the backend keep the entry while an equivalent reference exists. */
  removeProjectModel(
=======
  /** Deletes a removed project's stored model entry; resolves to the canonical path removed. The remaining project references let the backend keep the entry while an equivalent reference survives. */
  removeProjectModel(
    projectPath: string,
    remainingProjectPaths?: readonly string[],
  ): Promise<string>
  listProjectActions(projectPath: string): Promise<readonly ProjectAction[]>
  addProjectAction(
>>>>>>> d17cfe2f (fix(settings): stable alias identities, confirmed strips, and shared-reference removal)
    projectPath: string,
    remainingProjectPaths?: readonly string[],
  ): Promise<string>
}
