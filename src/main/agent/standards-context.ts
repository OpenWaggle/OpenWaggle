import type { Settings } from '@shared/types/settings'
import type { SkillActivationResult } from '@shared/types/standards'
import { activateSkillsFromText } from '../skills/skill-activation'
import {
  type LoadedSkillCatalog,
  type LoadedSkillDefinition,
  loadSkillCatalog,
} from '../skills/skill-catalog'
import { loadAgentsInstruction } from '../standards/agents-loader'

export interface ActiveSkillInstruction {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly body: string
  readonly folderPath: string
  readonly skillPath: string
  readonly hasScripts: boolean
}

export interface AgentStandardsContext {
  readonly agentsPath: string
  readonly agentsStatus: 'found' | 'missing' | 'error'
  readonly agentsInstruction: string | null
  readonly agentsError?: string
  readonly activation: SkillActivationResult
  readonly activeSkills: readonly ActiveSkillInstruction[]
  readonly warnings: readonly string[]
}

const EMPTY_ACTIVATION: SkillActivationResult = {
  explicitSkillIds: [],
  heuristicSkillIds: [],
  selectedSkillIds: [],
}

export const EMPTY_STANDARDS_CONTEXT: AgentStandardsContext = {
  agentsPath: '',
  agentsStatus: 'missing',
  agentsInstruction: null,
  activation: EMPTY_ACTIVATION,
  activeSkills: [],
  warnings: [],
}

export async function loadAgentStandardsContext(
  projectPath: string | null,
  userText: string,
  settings: Settings,
): Promise<AgentStandardsContext> {
  if (!projectPath) {
    return EMPTY_STANDARDS_CONTEXT
  }

  const warnings: string[] = []
  const agents = await loadAgentsInstruction(projectPath)
  if (agents.status === 'error' && agents.error) {
    warnings.push(`Failed to load AGENTS.md: ${agents.error}`)
  }

  const toggles = settings.skillTogglesByProject[projectPath] ?? {}
  let catalog: LoadedSkillCatalog = {
    projectPath,
    skills: [],
  }
  try {
    catalog = await loadSkillCatalog(projectPath, toggles)
  } catch (error) {
    warnings.push(
      `Failed to load skills catalog: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const activation = activateSkillsFromText(userText, catalog.skills)
  if (activation.unresolvedExplicitIds.length > 0) {
    warnings.push(
      `Some explicit skills were not found or are disabled: ${activation.unresolvedExplicitIds.join(', ')}`,
    )
  }

  for (const skill of catalog.skills) {
    if (skill.loadStatus === 'error' && skill.loadError) {
      warnings.push(`Failed to load skill "${skill.id}": ${skill.loadError}`)
    }
  }

  const skillsById = new Map(catalog.skills.map((skill) => [skill.id, skill]))
  const activeSkills: ActiveSkillInstruction[] = activation.selectedSkillIds
    .map((skillId) => skillsById.get(skillId))
    .filter((skill): skill is LoadedSkillDefinition => {
      return Boolean(skill && skill.loadStatus === 'ok' && skill.body)
    })
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      body: skill.body ?? '',
      folderPath: skill.folderPath,
      skillPath: skill.skillPath,
      hasScripts: skill.hasScripts,
    }))

  return {
    agentsPath: agents.filePath,
    agentsStatus: agents.status,
    agentsInstruction: agents.content,
    agentsError: agents.error,
    activation: {
      explicitSkillIds: activation.explicitSkillIds,
      heuristicSkillIds: activation.heuristicSkillIds,
      selectedSkillIds: activation.selectedSkillIds,
    },
    activeSkills,
    warnings,
  }
}
