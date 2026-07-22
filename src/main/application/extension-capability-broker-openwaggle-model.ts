import { BASE_TEN } from '@shared/constants/math'
import { SessionBranchId, SupportedModelId } from '@shared/types/brand'
import type {
  ExtensionModelPreferencesSettingsPatch,
  ExtensionModelPrefs,
  ExtensionSettingsProjectDisplayNameValue,
  ExtensionSettingsUpdatePayload,
  ExtensionSettingsView,
} from '@shared/types/extension-broker'
import type { SessionDetail, SessionTree } from '@shared/types/session'
import type { Settings } from '@shared/types/settings'

export function toExtensionModelPrefs(settings: Settings): ExtensionModelPrefs {
  return {
    selectedModel: settings.selectedModel,
    favoriteModels: [...settings.favoriteModels],
    enabledModels: [...settings.enabledModels],
    thinkingLevel: settings.thinkingLevel,
  }
}

export function toExtensionSettingsView(settings: Settings): ExtensionSettingsView {
  return {
    modelPreferences: toExtensionModelPrefs(settings),
    projectDisplayNames: { ...settings.projectDisplayNames },
  }
}

export function projectName(settings: Settings, projectPath: string) {
  const displayName = settings.projectDisplayNames[projectPath]?.trim()
  return displayName && displayName.length > 0 ? displayName : null
}

export function toActiveProjectView(settings: Settings) {
  const projectPath = settings.projectPath
  return projectPath
    ? {
        projectPath,
        displayName: projectName(settings, projectPath),
        active: true,
      }
    : null
}

export function toSessionView(session: SessionDetail | null) {
  return session
    ? {
        sessionId: session.id,
        title: session.title,
        projectPath: session.projectPath,
      }
    : null
}

export function toBranchView(tree: SessionTree | null, branchId: string) {
  const branch = tree?.branches.find((candidate) => candidate.id === SessionBranchId(branchId))
  return branch
    ? {
        branchId: branch.id,
        sessionId: branch.sessionId,
        name: branch.name,
        main: branch.isMain,
        archived: branch.archived === true,
      }
    : null
}

export function appendRecentProject(paths: readonly string[], projectPath: string) {
  const trimmed = projectPath.trim()
  if (trimmed.length === 0) {
    return [...paths]
  }

  return [...paths.filter((entry) => entry !== trimmed), trimmed].slice(-BASE_TEN)
}

export function toSettingsUpdatePatch(payload: ExtensionSettingsUpdatePayload): Partial<Settings> {
  return {
    ...(payload.selectedModel !== undefined
      ? { selectedModel: SupportedModelId(payload.selectedModel) }
      : {}),
    ...(payload.favoriteModels !== undefined
      ? { favoriteModels: payload.favoriteModels.map(SupportedModelId) }
      : {}),
    ...(payload.enabledModels !== undefined
      ? { enabledModels: payload.enabledModels.map(SupportedModelId) }
      : {}),
    ...(payload.thinkingLevel !== undefined ? { thinkingLevel: payload.thinkingLevel } : {}),
    ...(payload.projectDisplayNames !== undefined
      ? { projectDisplayNames: payload.projectDisplayNames }
      : {}),
  }
}

export function toModelPreferencesUpdatePatch(
  payload: ExtensionModelPreferencesSettingsPatch,
): Partial<Settings> {
  return {
    ...(payload.selectedModel !== undefined
      ? { selectedModel: SupportedModelId(payload.selectedModel) }
      : {}),
    ...(payload.favoriteModels !== undefined
      ? { favoriteModels: payload.favoriteModels.map(SupportedModelId) }
      : {}),
    ...(payload.enabledModels !== undefined
      ? { enabledModels: payload.enabledModels.map(SupportedModelId) }
      : {}),
    ...(payload.thinkingLevel !== undefined ? { thinkingLevel: payload.thinkingLevel } : {}),
  }
}

export function toProjectDisplayNameValue(
  settings: Settings,
  projectPath: string,
): ExtensionSettingsProjectDisplayNameValue {
  return {
    key: 'project-display-name',
    projectPath,
    value: projectName(settings, projectPath),
  }
}

export function toProjectDisplayNameUpdatePatch(input: {
  readonly settings: Settings
  readonly projectPath: string
  readonly value: string | null
}): Partial<Settings> {
  const projectDisplayNames = { ...input.settings.projectDisplayNames }
  const trimmedValue = input.value?.trim() ?? ''

  if (trimmedValue.length === 0) {
    delete projectDisplayNames[input.projectPath]
  } else {
    projectDisplayNames[input.projectPath] = trimmedValue
  }

  return { projectDisplayNames }
}
