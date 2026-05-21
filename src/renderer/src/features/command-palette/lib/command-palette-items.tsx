import type { SkillDiscoveryItem } from '@shared/types/standards'
import type { WagglePreset } from '@shared/types/waggle'
import {
  Archive,
  Copy,
  GitBranch,
  GitPullRequest,
  ListTree,
  MessageSquare,
  Settings,
  Shield,
  ShieldAlert,
  Swords,
  User,
  Waypoints,
} from 'lucide-react'
import { COMMAND_PALETTE } from '../constants'
import type { CommandPaletteActionHandlers, CommandPaletteItem } from '../model'
import { openFeedbackModal } from './command-palette-actions'
import { truncateCommandDescription } from './command-palette-text'

export function createBaseCommands(actions: CommandPaletteActionHandlers) {
  const optionalCommands: CommandPaletteItem[] = []
  appendOptionalCommand(optionalCommands, createSessionTreeCommand(actions))
  appendOptionalCommand(optionalCommands, createForkCommand(actions))
  appendOptionalCommand(optionalCommands, createCloneCommand(actions))

  return [
    {
      id: 'waggle',
      label: 'Waggle Mode',
      description: 'Start LLM collaboration session',
      icon: <Waypoints className="h-3.5 w-3.5" />,
      action: actions.startWaggle,
    },
    {
      id: 'feedback',
      label: 'Feedback',
      icon: <MessageSquare className="h-3.5 w-3.5" />,
      action: openFeedbackModal,
    },
    {
      id: 'compact',
      label: 'Compact session',
      description: 'Run /compact with optional instructions',
      icon: <Archive className="h-3.5 w-3.5" />,
      action: actions.insertCompactCommand,
    },
    ...optionalCommands,
  ]
}

export function filterBaseCommands(commands: readonly CommandPaletteItem[], lowerQuery: string) {
  if (!lowerQuery) return commands
  return commands.filter((command) => commandMatchesQuery(command, lowerQuery))
}

export function createSkillItems(
  slashSkills: readonly SkillDiscoveryItem[],
  lowerQuery: string,
  selectSkill: CommandPaletteActionHandlers['selectSkill'],
) {
  return slashSkills
    .filter((skill) => skill.enabled && skill.loadStatus === 'ok')
    .filter((skill) => skillMatchesQuery(skill, lowerQuery))
    .map((skill) => ({
      id: `skill-${skill.id}`,
      label: skill.name,
      description: truncateCommandDescription(skill.description, COMMAND_PALETTE.DESCRIPTION_LIMIT),
      icon: <Shield className="h-3.5 w-3.5" />,
      section: 'Skills',
      action: () => selectSkill(skill.id, skill.name),
    }))
}

export function createPresetItems(
  presets: readonly WagglePreset[],
  lowerQuery: string,
  selectPreset: CommandPaletteActionHandlers['selectPreset'],
) {
  return presets
    .filter((preset) => presetMatchesQuery(preset, lowerQuery))
    .map((preset) => ({
      id: `waggle-preset-${preset.id}`,
      label: preset.name,
      description: truncateCommandDescription(
        preset.description,
        COMMAND_PALETTE.WAGGLE_PRESET_DESCRIPTION_LIMIT,
      ),
      icon: presetIcon(preset),
      section: 'Waggle Mode',
      trailing: 'Sequential',
      trailingBadge: preset.isBuiltIn ? undefined : 'Custom',
      action: () => selectPreset(preset),
    }))
}

export function createConfigureWaggleItem(lowerQuery: string, configureWaggle: () => void) {
  if (!isWaggleFilter(lowerQuery)) return []
  return [
    {
      id: 'configure-waggle',
      label: 'Configure Waggle Mode...',
      description: 'Open Waggle Mode settings',
      icon: <Settings className="h-3.5 w-3.5" />,
      section: 'configure',
      action: configureWaggle,
    },
  ]
}

function createSessionTreeCommand(actions: CommandPaletteActionHandlers) {
  if (!actions.openSessionTree) return null
  return {
    id: 'session-tree',
    label: 'Open Session Tree',
    description: 'Navigate the Pi session tree',
    icon: <ListTree className="h-3.5 w-3.5" />,
    action: actions.openSessionTree,
  }
}

function createForkCommand(actions: CommandPaletteActionHandlers) {
  if (!actions.forkToNewSession) return null
  return {
    id: 'session-fork-to-new',
    label: 'Fork to new session...',
    description: 'Select a previous user message and continue in a new session',
    icon: <GitBranch className="h-3.5 w-3.5" />,
    action: actions.forkToNewSession,
  }
}

function createCloneCommand(actions: CommandPaletteActionHandlers) {
  if (!actions.cloneToNewSession) return null
  return {
    id: 'session-clone-to-new',
    label: 'Clone to new session',
    description: 'Duplicate the current session position',
    icon: <Copy className="h-3.5 w-3.5" />,
    action: actions.cloneToNewSession,
  }
}

function commandMatchesQuery(command: CommandPaletteItem, lowerQuery: string) {
  return (
    command.label.toLowerCase().includes(lowerQuery) ||
    Boolean(command.description?.toLowerCase().includes(lowerQuery))
  )
}

function skillMatchesQuery(skill: SkillDiscoveryItem, lowerQuery: string) {
  return (
    !lowerQuery ||
    skill.name.toLowerCase().includes(lowerQuery) ||
    skill.id.includes(lowerQuery) ||
    skill.description.toLowerCase().includes(lowerQuery)
  )
}

function presetMatchesQuery(preset: WagglePreset, lowerQuery: string) {
  return (
    !lowerQuery ||
    preset.name.toLowerCase().includes(lowerQuery) ||
    COMMAND_PALETTE.WAGGLE_QUERY.includes(lowerQuery)
  )
}

function isWaggleFilter(lowerQuery: string) {
  return (
    lowerQuery.length > 0 &&
    COMMAND_PALETTE.WAGGLE_QUERY.includes(lowerQuery) &&
    !lowerQuery.startsWith(COMMAND_PALETTE.WAGGLE_COMMAND_PREFIX)
  )
}

function presetIcon(preset: WagglePreset) {
  const name = preset.name.toLowerCase()
  if (name.includes('review')) return <GitPullRequest className="h-3.5 w-3.5" />
  if (name.includes('debate')) return <Swords className="h-3.5 w-3.5" />
  if (name.includes('red team')) return <ShieldAlert className="h-3.5 w-3.5" />
  if (name.includes('qa') || name.includes('test')) return <Shield className="h-3.5 w-3.5" />
  return <User className="h-3.5 w-3.5" />
}

function appendOptionalCommand(commands: CommandPaletteItem[], command: CommandPaletteItem | null) {
  if (command) {
    commands.push(command)
  }
}
