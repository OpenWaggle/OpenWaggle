import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { getProjectMcpSettings, setProjectMcpSettings } from '../config/project-config'
import { ProjectMcpSettingsService } from '../ports/project-mcp-settings-service'

export const ProjectMcpSettingsLive = Layer.succeed(
  ProjectMcpSettingsService,
  ProjectMcpSettingsService.of({
    get: (projectPath) =>
      Effect.tryPromise({
        try: () => getProjectMcpSettings(projectPath),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
    set: (projectPath, settings) =>
      Effect.tryPromise({
        try: () => setProjectMcpSettings(projectPath, settings),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
  }),
)
