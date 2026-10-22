import { useQuery } from '@tanstack/react-query'
import { useSessionStore } from '@/features/sessions/state'
import { usePreferencesStore } from '@/features/settings/state'
import { agentDefinitionsQueryOptions } from '@/queries/agent-definitions'
import { projectName } from '@/shared/lib/format'

export interface TargetOption {
  readonly value: string
  readonly label: string
}

/** Non-archived Sessions a Heartbeat can deliver into, plus the one it already targets. */
export function useHeartbeatSessionOptions(currentSessionId: string): readonly TargetOption[] {
  const sessions = useSessionStore((state) => state.sessions)
  const options = sessions
    .filter((session) => session.archived !== true)
    .map((session) => ({
      value: String(session.id),
      label: `${session.title || 'Untitled session'} — ${projectName(session.projectPath)}`,
    }))
  if (currentSessionId !== '' && !options.some((option) => option.value === currentSessionId)) {
    options.unshift({ value: currentSessionId, label: 'Current target Session' })
  }
  return options
}

/** The projects OpenWaggle knows: the open one, recent ones, and those listed Sessions use. */
export function useLaunchProjectOptions(currentProjectPath: string): readonly TargetOption[] {
  const projectPath = usePreferencesStore((state) => state.settings.projectPath)
  const recentProjects = usePreferencesStore((state) => state.settings.recentProjects)
  const sessions = useSessionStore((state) => state.sessions)
  const paths = new Set<string>()
  for (const path of [currentProjectPath, projectPath, ...recentProjects]) {
    if (path) paths.add(path)
  }
  for (const session of sessions) {
    if (session.projectPath) paths.add(session.projectPath)
  }
  return [...paths]
    .map((path) => ({ value: path, label: `${projectName(path)} — ${path}` }))
    .sort((left, right) => left.label.localeCompare(right.label))
}

export function useEnabledModelOptions(currentModelId: string): readonly TargetOption[] {
  const enabledModels = usePreferencesStore((state) => state.settings.enabledModels)
  const models = new Set<string>(enabledModels)
  if (currentModelId) models.add(currentModelId)
  return [...models].map((model) => ({ value: model, label: model }))
}

/** Agent definitions in the chosen project, or none until a project is chosen. */
export function useAgentDefinitionOptions(
  projectPath: string,
  currentName: string,
): readonly TargetOption[] {
  const definitions = useQuery(agentDefinitionsQueryOptions(projectPath || null))
  const names = new Set(
    (definitions.data ?? [])
      .filter((definition) => definition.enabled && !definition.loadError)
      .map((definition) => definition.name),
  )
  // A stored name stays selectable even if it no longer resolves; the run then fails visibly.
  if (currentName) names.add(currentName)
  return [...names].map((name) => ({ value: name, label: name }))
}
