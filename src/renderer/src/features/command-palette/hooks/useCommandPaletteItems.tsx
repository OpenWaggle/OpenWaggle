import type { SkillDiscoveryItem } from '@shared/types/standards'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { extensionSlashCommandText } from '@/features/composer/commands'
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
  const wagglePresetsQuery = useQuery(wagglePresetsQueryOptions(projectPath))
  const extensionContributionsQuery = useQuery(extensionContributionsQueryOptions(projectPaths))
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

    closeCommandPalette()
    void api
      .invokeExtension({
        extensionId: entry.extensionId,
        contributionId: entry.contributionId,
        capability: entry.capability,
        method: entry.method,
        scope: projectPath
          ? { kind: 'project', projectPath }
          : {
              kind: 'app',
            },
        payload: {},
      })
      .then((result) => {
        if (!result.ok) {
          logger.warn('Extension command rejected', {
            extensionId: entry.extensionId,
            contributionId: entry.contributionId,
            code: result.error.code,
          })
        }
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
      },
    })
  }

  return [
    ...filterBaseCommands(createBaseCommands(actions), lowerQuery),
    ...createSkillItems(slashSkills, lowerQuery, actions.selectSkill),
    ...createPresetItems(wagglePresetsQuery.data ?? [], lowerQuery, actions.selectPreset),
    ...createExtensionSlashCommandItems({
      registry: extensionContributionsQuery.data ?? null,
      lowerQuery,
      insertCommand: insertExtensionSlashCommand,
    }),
    ...createExtensionSidePanelItems({
      registry: extensionContributionsQuery.data ?? null,
      lowerQuery,
      openSidePanel: openExtensionSidePanel,
    }),
    ...createExtensionCommandItems({
      registry: extensionContributionsQuery.data ?? null,
      lowerQuery,
      invokeCommand: invokeExtensionCommand,
    }),
    ...createConfigureWaggleItem(lowerQuery, actions.configureWaggle),
  ]
}
