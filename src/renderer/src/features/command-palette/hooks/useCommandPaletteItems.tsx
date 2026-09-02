import type { SkillDiscoveryItem } from '@shared/types/standards'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { extensionSlashCommandText } from '@/features/composer/commands'
import { consumeActiveSlashCommand } from '@/features/composer/lib'
import type { SlashMenuFilter } from '@/features/composer/state'
import { usePreferencesStore } from '@/features/settings/state'
import { extensionContributionsQueryOptions } from '@/queries/extensions'
import { wagglePresetsQueryOptions } from '@/queries/waggle-presets'
import { useUIStore } from '@/shell/ui-store'
import { insertComposerCommandText } from '../lib/command-palette-actions'
import {
  createConfigureWaggleItem,
  createPresetItems,
  createSkillItems,
} from '../lib/command-palette-items'
import { normalizeCommandQuery } from '../lib/command-palette-text'
import {
  createExtensionSlashCommandItems,
  type ExtensionSlashCommandActionInput,
} from '../lib/extension-command-items'
import type { CommandPaletteActionHandlers, CommandPaletteCallbacks } from '../model'

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
  readonly filter: SlashMenuFilter
  readonly query: string
  readonly slashSkills: readonly SkillDiscoveryItem[]
}

export function useCommandPaletteItems({
  filter,
  query,
  slashSkills,
  onSelectSkill,
  onStartWaggle,
}: UseCommandPaletteItemsInput) {
  const navigate = useNavigate()
  const closeSlashCommandMenu = useUIStore((s) => s.closeSlashCommandMenu)
  const projectPath = usePreferencesStore((state) => state.settings.projectPath)
  const projectPaths = projectPath ? [projectPath] : []
  const sessionId = sessionIdFromPathname(currentHashPathname())
  const { data: wagglePresets = [] } = useQuery(wagglePresetsQueryOptions(projectPath))
  const { data: extensionContributions = null } = useQuery(
    extensionContributionsQueryOptions(projectPaths, { sessionId }),
  )
  const lowerQuery = normalizeCommandQuery(query)
  const consumeAndClose = () => {
    consumeActiveSlashCommand()
    closeSlashCommandMenu()
  }
  const configureWaggle = () => {
    consumeAndClose()
    void navigate({ to: '/settings/$tab', params: { tab: 'waggle' } })
  }
  const actions: CommandPaletteActionHandlers = {
    closeSlashCommandMenu,
    configureWaggle,
    selectPreset: (preset) => {
      onStartWaggle(preset)
      closeSlashCommandMenu()
    },
    selectSkill: (skillId, skillName) => {
      onSelectSkill(skillId, skillName)
      closeSlashCommandMenu()
    },
    insertCompactCommand: closeSlashCommandMenu,
  }
  const insertExtensionSlashCommand = ({ entry }: ExtensionSlashCommandActionInput) => {
    insertComposerCommandText(extensionSlashCommandText(entry))
    closeSlashCommandMenu()
  }
  const skillItems = createSkillItems(slashSkills, lowerQuery, actions.selectSkill)
  const presetItems = createPresetItems(wagglePresets, lowerQuery, actions.selectPreset)
  const configureWaggleItems = createConfigureWaggleItem(lowerQuery, actions.configureWaggle)
  if (filter === 'skills') return skillItems
  if (filter === 'waggle') return [...presetItems, ...configureWaggleItems]

  return [
    ...skillItems,
    ...presetItems,
    ...createExtensionSlashCommandItems({
      registry: extensionContributions,
      lowerQuery,
      insertCommand: insertExtensionSlashCommand,
    }),
    ...configureWaggleItems,
  ]
}
