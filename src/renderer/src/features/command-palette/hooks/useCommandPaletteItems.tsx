import type { SkillDiscoveryItem } from '@shared/types/standards'
import type { ExtensionInvokeScope } from '@shared/types/extension-broker'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { extensionSlashCommandText } from '@/features/composer/commands'
import { refreshPreferencesAfterExtensionInvoke } from '@/features/extensions'
import { usePreferencesStore } from '@/features/settings/state'
import { useWaggleStore } from '@/features/waggle/state'
import { extensionContributionsQueryOptions } from '@/queries/extensions'
import { wagglePresetsQueryOptions } from '@/queries/waggle-presets'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { EXTENSION_SIDE_PANEL_ROUTE_PANEL, useUIStore } from '@/shell/ui-store'
import {
  createOptionalCommandPaletteAction,
  insertCompactCommand,
  insertComposerCommandText,
} from '../lib/command-palette-actions'
import {
  createBaseCommands,
  createConfigureWaggleItem,
  createPresetItems,
  createSkillItems,
  filterBaseCommands,
} from '../lib/command-palette-items'
import { normalizeCommandQuery } from '../lib/command-palette-text'
import {
  createExtensionCommandItems,
  createExtensionSidePanelItems,
  createExtensionSlashCommandItems,
  type ExtensionCommandActionInput,
  type ExtensionSidePanelActionInput,
  type ExtensionSlashCommandActionInput,
} from '../lib/extension-command-items'
import type { CommandPaletteActionHandlers, CommandPaletteCallbacks } from '../model'

const logger = createRendererLogger('command-palette')

function currentHashPathname() {
  const hash = window.location.hash
  if (!hash.startsWith('#')) {
    return window.location.pathname
  }

  const [pathname] = hash.slice(1).split('?')
  return pathname && pathname.length > 0 ? pathname : '/'
}

function sessionIdFromPathname(pathname: string) {
  if (!pathname.startsWith('/sessions/')) {
    return null
  }

  const [, sessionsSegment, sessionId] = pathname.split('/')
  return sessionsSegment === 'sessions' && sessionId ? sessionId : null
}

function extensionCommandInvocationScope(input: {
  readonly entry: ExtensionContributionRegistryEntry
  readonly projectPath: string | null | undefined
}): ExtensionInvokeScope | null {
  const { entry, projectPath } = input
  const declaredScopes = entry.declaredScopes

  if (declaredScopes === undefined) {
    return projectPath ? { kind: 'project', projectPath } : { kind: 'app' }
  }

  if (
    projectPath &&
    declaredScopes.includes('project') &&
    entry.projectPaths.includes(projectPath)
  ) {
    return { kind: 'project', projectPath }
  }

  if (declaredScopes.includes('app')) {
    return { kind: 'app' }
  }

  return null
}

interface UseCommandPaletteItemsInput extends CommandPaletteCallbacks {
  readonly query: string
  readonly slashSkills: readonly SkillDiscoveryItem[]
}

export function useCommandPaletteItems({
  query,
  slashSkills,
  onSelectSkill,
  onStartWaggle,
  onOpenSessionTree,
  onForkToNewSession,
  onCloneToNewSession,
}: UseCommandPaletteItemsInput) {
  const navigate = useNavigate()
  const closeCommandPalette = useUIStore((s) => s.closeCommandPalette)
  const setLastRightSidebarPanel = useUIStore((s) => s.setLastRightSidebarPanel)
  const projectPath = usePreferencesStore((state) => state.settings.projectPath)
  const projectPaths = projectPath ? [projectPath] : []
  const { data: wagglePresets = [] } = useQuery(wagglePresetsQueryOptions(projectPath))
  const { data: extensionContributions = null } = useQuery(
    extensionContributionsQueryOptions(projectPaths),
  )
  const lowerQuery = normalizeCommandQuery(query)
  const configureWaggle = () => {
    closeCommandPalette()
    void navigate({ to: '/settings/$tab', params: { tab: 'waggle' } })
  }
  const actions: CommandPaletteActionHandlers = {
    closeCommandPalette,
    configureWaggle,
    selectPreset: (preset) => {
      onStartWaggle(preset.config)
      closeCommandPalette()
    },
    startWaggle: () => {
      const config = useWaggleStore.getState().activeConfig
      if (!config) {
        configureWaggle()
        return
      }
      onStartWaggle(config)
      closeCommandPalette()
    },
    selectSkill: (skillId, skillName) => {
      onSelectSkill(skillId, skillName)
      closeCommandPalette()
    },
    openSessionTree: createOptionalCommandPaletteAction(closeCommandPalette, onOpenSessionTree),
    forkToNewSession: createOptionalCommandPaletteAction(closeCommandPalette, onForkToNewSession),
    cloneToNewSession: createOptionalCommandPaletteAction(closeCommandPalette, onCloneToNewSession),
    insertCompactCommand: () => {
      insertCompactCommand()
      closeCommandPalette()
    },
  }
  const invokeExtensionCommand = ({ entry }: ExtensionCommandActionInput) => {
    if (!entry.capability || !entry.method) {
      return
    }
    const scope = extensionCommandInvocationScope({ entry, projectPath })
    if (scope === null) {
      logger.warn('Extension command has no command-palette invocation scope', {
        extensionId: entry.extensionId,
        contributionId: entry.contributionId,
        declaredScopes: entry.declaredScopes,
      })
      return
    }

    closeCommandPalette()
    void api
      .invokeExtension({
        extensionId: entry.extensionId,
        contributionId: entry.contributionId,
        capability: entry.capability,
        method: entry.method,
        scope,
        payload: {},
      })
      .then(async (result) => {
        if (!result.ok) {
          logger.warn('Extension command rejected', {
            extensionId: entry.extensionId,
            contributionId: entry.contributionId,
            code: result.error.code,
          })
          return
        }

        await refreshPreferencesAfterExtensionInvoke(result)
      })
      .catch((error: unknown) => {
        logger.warn('Extension command failed', { error: String(error) })
      })
  }
  const insertExtensionSlashCommand = ({ entry }: ExtensionSlashCommandActionInput) => {
    insertComposerCommandText(extensionSlashCommandText(entry))
    closeCommandPalette()
  }
  const openExtensionSidePanel = ({ entry }: ExtensionSidePanelActionInput) => {
    const target = {
      kind: 'extension-side-panel',
      extensionId: entry.extensionId,
      sidePanelId: entry.contributionId,
      packagePath: entry.packagePath,
      contentHash: entry.contentHash,
    } as const
    const sessionId = sessionIdFromPathname(currentHashPathname())

    setLastRightSidebarPanel(target)
    closeCommandPalette()

    if (sessionId) {
      void navigate({
        to: '/sessions/$sessionId',
        params: { sessionId },
        search: (previous) => ({
          ...previous,
          diff: undefined,
          panel: EXTENSION_SIDE_PANEL_ROUTE_PANEL,
          sidePanelExtensionId: target.extensionId,
          sidePanelId: target.sidePanelId,
          sidePanelPackagePath: target.packagePath,
          sidePanelContentHash: target.contentHash,
        }),
      })
      return
    }

    void navigate({
      to: '/',
      search: {
        diff: undefined,
        panel: EXTENSION_SIDE_PANEL_ROUTE_PANEL,
        sidePanelExtensionId: target.extensionId,
        sidePanelId: target.sidePanelId,
        sidePanelPackagePath: target.packagePath,
        sidePanelContentHash: target.contentHash,
      },
    })
  }

  return [
    ...filterBaseCommands(createBaseCommands(actions), lowerQuery),
    ...createSkillItems(slashSkills, lowerQuery, actions.selectSkill),
    ...createPresetItems(wagglePresets, lowerQuery, actions.selectPreset),
    ...createExtensionSlashCommandItems({
      registry: extensionContributions,
      lowerQuery,
      insertCommand: insertExtensionSlashCommand,
    }),
    ...createExtensionSidePanelItems({
      registry: extensionContributions,
      lowerQuery,
      openSidePanel: openExtensionSidePanel,
    }),
    ...createExtensionCommandItems({
      registry: extensionContributions,
      lowerQuery,
      invokeCommand: invokeExtensionCommand,
      canInvokeCommand: (entry) =>
        extensionCommandInvocationScope({ entry, projectPath }) !== null,
    }),
    ...createConfigureWaggleItem(lowerQuery, actions.configureWaggle),
  ]
}
