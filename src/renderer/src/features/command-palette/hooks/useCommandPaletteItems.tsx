import type { SkillDiscoveryItem } from '@shared/types/standards'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { usePreferencesStore } from '@/features/settings/state'
import { useWaggleStore } from '@/features/waggle/state'
import { wagglePresetsQueryOptions } from '@/queries/waggle-presets'
import { useUIStore } from '@/shell/ui-store'
import {
  createOptionalCommandPaletteAction,
  insertCompactCommand,
} from '../lib/command-palette-actions'
import {
  createBaseCommands,
  createConfigureWaggleItem,
  createPresetItems,
  createSkillItems,
  filterBaseCommands,
} from '../lib/command-palette-items'
import { normalizeCommandQuery } from '../lib/command-palette-text'
import type { CommandPaletteActionHandlers, CommandPaletteCallbacks } from '../model'

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
  const projectPath = usePreferencesStore((state) => state.settings.projectPath)
  const wagglePresetsQuery = useQuery(wagglePresetsQueryOptions(projectPath))
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

  return [
    ...filterBaseCommands(createBaseCommands(actions), lowerQuery),
    ...createSkillItems(slashSkills, lowerQuery, actions.selectSkill),
    ...createPresetItems(wagglePresetsQuery.data ?? [], lowerQuery, actions.selectPreset),
    ...createConfigureWaggleItem(lowerQuery, actions.configureWaggle),
  ]
}
