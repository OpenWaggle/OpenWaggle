import type { McpProjectMode } from '@shared/types/settings'
import { Context, type Effect } from 'effect'

export interface ProjectMcpSettings {
  readonly enabled: McpProjectMode
}

export interface ProjectMcpSettingsServiceShape {
  readonly get: (projectPath: string) => Effect.Effect<ProjectMcpSettings, Error>
  readonly set: (projectPath: string, settings: ProjectMcpSettings) => Effect.Effect<void, Error>
}

export class ProjectMcpSettingsService extends Context.Tag('@openwaggle/ProjectMcpSettingsService')<
  ProjectMcpSettingsService,
  ProjectMcpSettingsServiceShape
>() {}
