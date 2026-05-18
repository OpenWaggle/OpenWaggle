import type { McpDefaultMode, McpProjectMode } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { ProjectMcpSettingsService } from '../ports/project-mcp-settings-service'
import { SettingsService } from '../services/settings-service'

export function resolveEffectiveMcpEnabled(
  globalDefault: McpDefaultMode,
  projectOverride: McpProjectMode,
): boolean {
  if (projectOverride === 'enabled') {
    return true
  }
  if (projectOverride === 'disabled') {
    return false
  }
  return globalDefault === 'enabled'
}

export function getEffectiveMcpEnabled(projectPath: string | null | undefined) {
  return Effect.gen(function* () {
    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()
    if (!projectPath) {
      return settings.mcpDefault === 'enabled'
    }

    const projectMcpSettings = yield* ProjectMcpSettingsService
    const projectSettings = yield* projectMcpSettings.get(projectPath)
    return resolveEffectiveMcpEnabled(settings.mcpDefault, projectSettings.enabled)
  })
}
