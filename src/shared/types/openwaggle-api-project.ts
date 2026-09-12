/**
 * Renderer-facing project configuration API.
 *
 * Split out of `openwaggle-api.ts`, which is at its line limit. Grouped because the payload shapes
 * and the two calls that use them only make sense together: reading a project's overrides, and
 * writing them where `null` clears a key.
 */
import type { AgentAuthorizationMode } from './agent-authorization'
import type {
  ProjectAction,
  ProjectActionInput,
  ProjectActionUpdate,
  T3ProjectActionsDiscovery,
} from './project-actions'

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
  selectProjectFolder(): Promise<string | null>
  getProjectPreferences(projectPath: string): Promise<ProjectPreferencesPayload | null>
  setProjectPreferences(
    projectPath: string,
    preferences: ProjectPreferencesUpdatePayload,
  ): Promise<void>
  listProjectActions(projectPath: string): Promise<readonly ProjectAction[]>
  addProjectAction(
    projectPath: string,
    input: ProjectActionInput,
  ): Promise<readonly ProjectAction[]>
  updateProjectAction(
    projectPath: string,
    actionId: string,
    update: ProjectActionUpdate,
  ): Promise<readonly ProjectAction[]>
  deleteProjectAction(projectPath: string, actionId: string): Promise<readonly ProjectAction[]>
  discoverT3ProjectActions(projectPath: string): Promise<T3ProjectActionsDiscovery>
  importT3ProjectAction(projectPath: string, sourceIndex: number): Promise<readonly ProjectAction[]>
}
