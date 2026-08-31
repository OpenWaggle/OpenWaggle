import type { SchemaType } from '@shared/schema'
import type { projectSettingsFileSchema } from '@shared/schemas/validation'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { ScopedAuthorizationGrant } from '@shared/types/agent-authorization-grants'
import type { JsonObject } from '@shared/types/json'
import type { ThinkingLevel } from '@shared/types/settings'

export interface ProjectPreferences {
  readonly model?: string
  readonly thinkingLevel?: ThinkingLevel
  readonly authorizationMode?: AgentAuthorizationMode
}

/** A preference write, where `null` deletes the key and `undefined` leaves it alone. */
export interface ProjectPreferencesUpdate {
  readonly model?: string | null
  readonly thinkingLevel?: ThinkingLevel | null
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
}

export type ParsedProjectSettingsFile = SchemaType<typeof projectSettingsFileSchema>

const EMPTY_CONFIG: ProjectConfig = {}

function parseProjectPreferences(
  settings: ParsedProjectSettingsFile | null,
): ProjectPreferences | undefined {
  const model = settings?.preferences?.model
  const thinkingLevel = settings?.preferences?.thinkingLevel
  const authorizationMode = settings?.preferences?.authorizationMode
  if (!model && !thinkingLevel && !authorizationMode) return undefined
  return {
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
    ...(authorizationMode ? { authorizationMode } : {}),
  }
}

export function parseProjectConfig(settings: ParsedProjectSettingsFile | null): ProjectConfig {
  const preferences = parseProjectPreferences(settings)
  const grants = settings?.authorizationGrants ?? []
  if (!preferences && !settings?.sessionHost && grants.length === 0 && !settings?.pi) {
    return EMPTY_CONFIG
  }
  return {
    ...(preferences ? { preferences } : {}),
    ...(settings?.sessionHost ? { sessionHost: settings.sessionHost } : {}),
    ...(grants.length > 0 ? { authorizationGrants: grants } : {}),
    ...(settings?.pi ? { pi: settings.pi } : {}),
  }
}
