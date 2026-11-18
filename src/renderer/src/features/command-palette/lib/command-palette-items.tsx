import type { SkillDiscoveryItem } from '@shared/types/standards'
import type { WagglePreset } from '@shared/types/waggle'
import { skillCommandText } from '@shared/utils/skill-id'
import {
  Archive,
  ChartNoAxesCombined,
  Copy,
  GitFork,
  GitPullRequest,
  type LucideIcon,
  Settings,
  Shield,
  ShieldAlert,
  Swords,
  User,
} from 'lucide-react'
import { BUILT_IN_COMPOSER_SLASH_COMMAND } from '@/features/composer/commands'
import { COMMAND_PALETTE } from '../constants/command-palette'
import type {
  CommandPaletteActionHandlers,
  CommandPaletteItem,
} from '../model/command-palette-item'
import { truncateCommandDescription } from './command-palette-text'

interface BuiltInComposerCommand {
  readonly command: string
  readonly label: string
  readonly description: string
  readonly Icon: LucideIcon
}

/**
 * GUI-only built-in text commands, mirroring Pi's slash-command set. They are listed in the
 * composer chooser so they are discoverable and so a fuzzy skill match (for example a skill whose
 * description mentions "compact") can never capture Enter on a fully typed built-in command.
 */
const BUILT_IN_COMPOSER_COMMANDS: readonly BuiltInComposerCommand[] = [
  {
    command: BUILT_IN_COMPOSER_SLASH_COMMAND.COMPACT,
    label: 'Compact session',
    description: 'Manually compact the session context',
    Icon: Archive,
  },
  {
    command: BUILT_IN_COMPOSER_SLASH_COMMAND.FORK,
    label: 'Fork session',
    description: 'Create a new fork from a previous user message',
    Icon: GitFork,
  },
  {
    command: BUILT_IN_COMPOSER_SLASH_COMMAND.CLONE,
    label: 'Clone session',
    description: 'Duplicate the current session',
    Icon: Copy,
  },
]

/** Like Pi's TUI, built-ins match by command name so short queries still reach skills. */
function builtInCommandMatchesQuery(entry: BuiltInComposerCommand, lowerQuery: string) {
  return entry.command.slice(1).startsWith(lowerQuery)
}

export function createBuiltInCommandItems(
  lowerQuery: string,
  insertCommand: (command: string) => void,
) {
  return BUILT_IN_COMPOSER_COMMANDS.filter((entry) =>
    builtInCommandMatchesQuery(entry, lowerQuery),
  ).map((entry) => ({
    id: `command-${entry.command.slice(1)}`,
    label: entry.label,
    description: entry.description,
    icon: <entry.Icon className="size-3.5" />,
    section: 'Commands',
    trailing: entry.command,
    // A fully typed command that is the whole draft submits on Enter, like Pi's TUI; Tab or a
    // click completes it so arguments such as /compact instructions can be added.
    submitsOnEnter: entry.command.slice(1) === lowerQuery,
    action: () => insertCommand(entry.command),
  }))
}

/**
 * The lowercased names this project's enabled skills are offered under: the frontmatter name each
 * SKILL.md declares, which is also what Pi matches after `/skill:`. The slash menu withholds a Pi
 * extension command under one of these names, so a name never labels two rows. A skill's folder id
 * is not one of them: Pi resolves a skill by name alone, so an extension command named after the
 * folder still runs and keeps its row.
 */
export function skillOwnedCommandNames(skills: readonly SkillDiscoveryItem[]) {
  const names = new Set<string>()
  for (const skill of skills) {
    if (!skill.enabled || skill.loadStatus !== 'ok') continue
    names.add(skill.name.toLowerCase())
  }
  return names
}

export function createSkillItems(
  slashSkills: readonly SkillDiscoveryItem[],
  lowerQuery: string,
  selectSkill: CommandPaletteActionHandlers['selectSkill'],
) {
  const items: CommandPaletteItem[] = []
  if (visualizeSkillMatchesQuery(lowerQuery)) {
    const diagnostic = slashSkills.find(
      (skill) => skill.id === 'visualize' && skill.loadStatus === 'error',
    )
    items.push({
      id: 'skill-visualize',
      label: 'Visualize',
      description: diagnostic
        ? `Unavailable: ${diagnostic.loadError ?? diagnostic.description}`
        : 'Create an interactive visualization in this conversation',
      icon: <ChartNoAxesCombined className="size-3.5" />,
      section: 'Skills',
      trailing: skillCommandText('visualize'),
      disabled: diagnostic !== undefined,
      action: diagnostic ? () => undefined : () => selectSkill('visualize', 'Visualize'),
    })
  }

  for (const skill of rankedSkillMatches(slashSkills, lowerQuery)) {
    items.push({
      id: `skill-${skill.id}`,
      label: skill.name,
      description: truncateCommandDescription(skill.description, COMMAND_PALETTE.DESCRIPTION_LIMIT),
      icon: <Shield className="size-3.5" />,
      section: 'Skills',
      // Pi resolves a skill command by the `name` in SKILL.md's frontmatter, not by the folder the
      // skill lives in, so the invocation the chip carries must be that name (`skill.id` is the
      // normalized folder). Pi passes an unknown name through silently, so the id would look
      // handled while the body never loaded.
      action: () => selectSkill(skill.name, skill.name),
    })
  }

  return items
}

function visualizeSkillMatchesQuery(lowerQuery: string) {
  return (
    !lowerQuery ||
    'visualize'.includes(lowerQuery) ||
    'create an interactive visualization in this conversation'.includes(lowerQuery)
  )
}

/**
 * Slash-menu match tiers, best first: a fully typed skill name, then a name prefix, a name
 * substring, the folder id, and finally a description hit. Description matching stays so a user
 * who does not remember a name can still find the skill, but a skill whose name is typed exactly
 * must lead the list instead of hiding behind description matches discovered earlier.
 */
const SKILL_MATCH_TIERS = {
  EXACT_NAME: 0,
  NAME_PREFIX: 1,
  NAME_SUBSTRING: 2,
  FOLDER_ID: 3,
  DESCRIPTION: 4,
} as const

/**
 * Match tier for a skill against a non-empty lowercased query, best first; null when nothing
 * matches. Callers decide the empty-query convention (an empty query matches every skill), so
 * this must never be consulted with one.
 */
function skillMatchTier(skill: SkillDiscoveryItem, lowerQuery: string) {
  const name = skill.name.toLowerCase()
  if (name === lowerQuery) return SKILL_MATCH_TIERS.EXACT_NAME
  if (name.startsWith(lowerQuery)) return SKILL_MATCH_TIERS.NAME_PREFIX
  if (name.includes(lowerQuery)) return SKILL_MATCH_TIERS.NAME_SUBSTRING
  if (skill.id.includes(lowerQuery)) return SKILL_MATCH_TIERS.FOLDER_ID
  if (skill.description.toLowerCase().includes(lowerQuery)) {
    return SKILL_MATCH_TIERS.DESCRIPTION
  }
  return null
}

/**
 * Enabled, loadable skills matching the query, ordered best match first. An empty query keeps
 * the discovery order (every skill matches with no tier); the sort is stable, so equal tiers
 * preserve discovery order too.
 */
function rankedSkillMatches(slashSkills: readonly SkillDiscoveryItem[], lowerQuery: string) {
  const eligible = slashSkills.filter(
    (skill) => skill.id !== 'visualize' && skill.enabled && skill.loadStatus === 'ok',
  )
  if (!lowerQuery) return eligible
  const matches: { skill: SkillDiscoveryItem; tier: number }[] = []
  for (const skill of eligible) {
    const tier = skillMatchTier(skill, lowerQuery)
    if (tier === null) continue
    matches.push({ skill, tier })
  }
  matches.sort((a, b) => a.tier - b.tier)
  return matches.map((match) => match.skill)
}

export function createPresetItems(
  presets: readonly WagglePreset[],
  lowerQuery: string,
  selectPreset: CommandPaletteActionHandlers['selectPreset'],
) {
  const items: CommandPaletteItem[] = []
  for (const preset of presets) {
    if (!presetMatchesQuery(preset, lowerQuery)) continue

    items.push({
      id: `waggle-preset-${preset.id}`,
      label: preset.name,
      description: truncateCommandDescription(
        preset.description,
        COMMAND_PALETTE.WAGGLE_PRESET_DESCRIPTION_LIMIT,
      ),
      icon: presetIcon(preset),
      section: 'Waggle Mode',
      trailing: 'Sequential',
      ...(preset.isBuiltIn ? {} : { trailingBadge: 'Custom' }),
      action: () => selectPreset(preset),
    })
  }

  return items
}

export function createConfigureWaggleItem(lowerQuery: string, configureWaggle: () => void) {
  if (!isWaggleFilter(lowerQuery)) return []
  return [
    {
      id: 'configure-waggle',
      label: 'Configure Waggle Mode...',
      description: 'Open Waggle Mode settings',
      icon: <Settings className="size-3.5" />,
      section: 'configure',
      action: configureWaggle,
    },
  ]
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
  if (name.includes('review')) return <GitPullRequest className="size-3.5" />
  if (name.includes('debate')) return <Swords className="size-3.5" />
  if (name.includes('red team')) return <ShieldAlert className="size-3.5" />
  if (name.includes('qa') || name.includes('test')) return <Shield className="size-3.5" />
  return <User className="size-3.5" />
}
