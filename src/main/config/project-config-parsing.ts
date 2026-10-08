import type { SchemaType } from '@shared/schema'
import type { projectSettingsFileSchema } from '@shared/schemas/validation'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { ScopedAuthorizationGrant } from '@shared/types/agent-authorization-grants'
import type { JsonObject } from '@shared/types/json'
import type { ProjectAction } from '@shared/types/project-actions'

export interface ProjectPreferences {
  readonly model?: string
  readonly authorizationMode?: AgentAuthorizationMode
}

/** A preference write to the repo-local settings file, where `null` deletes the key and `undefined` leaves it alone. */
export interface ProjectPreferencesUpdate {
  readonly authorizationMode?: AgentAuthorizationMode | null
}

export interface ProjectConfig {
  readonly preferences?: ProjectPreferences
  readonly sessionHost?: {
    readonly multiAgentEnabled?: boolean
    readonly parentConcurrencyLimit?: number
  }
  readonly authorizationGrants?: readonly ScopedAuthorizationGrant[]
  readonly pi?: JsonObject
  readonly actions?: readonly ProjectAction[]
  /** Raw shared source-control section, parsed entry by entry by its own module (ADR 0048). */
  readonly sourceControl?: JsonObject
}

export type ParsedProjectSettingsFile = SchemaType<typeof projectSettingsFileSchema>

const EMPTY_CONFIG: ProjectConfig = {}

function parseProjectPreferences(
  settings: ParsedProjectSettingsFile | null,
): ProjectPreferences | undefined {
  const model = settings?.preferences?.model
  const authorizationMode = settings?.preferences?.authorizationMode
  if (!model && !authorizationMode) return undefined
  return {
    ...(model ? { model } : {}),
    ...(authorizationMode ? { authorizationMode } : {}),
  }
}

export function parseProjectConfig(settings: ParsedProjectSettingsFile | null): ProjectConfig {
  if (settings === null) return EMPTY_CONFIG
  const preferences = parseProjectPreferences(settings)
  const grants = settings.authorizationGrants ?? []
  const actions = settings.actions ?? []
  const config: ProjectConfig = {
    ...(preferences ? { preferences } : {}),
    ...(settings.sessionHost ? { sessionHost: settings.sessionHost } : {}),
    ...(grants.length > 0 ? { authorizationGrants: grants } : {}),
    ...(settings.pi ? { pi: settings.pi } : {}),
    ...(actions.length > 0 ? { actions } : {}),
    ...(settings.sourceControl ? { sourceControl: settings.sourceControl } : {}),
  }
  return Object.keys(config).length === 0 ? EMPTY_CONFIG : config
}
