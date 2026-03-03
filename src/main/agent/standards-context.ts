import path from 'node:path'
import type { PreparedAttachment } from '@shared/types/agent'
import type { Settings } from '@shared/types/settings'
import type { SkillActivationResult, SkillDiscoveryItem } from '@shared/types/standards'
import { inferAgentsCandidatePaths } from '@shared/utils/agents-path-inference'
import { isPathInside } from '@shared/utils/paths'
import { activateSkillsFromText } from '../skills/skill-activation'
import {
  type LoadedSkillCatalog,
  loadSkillCatalog,
  loadSkillInstructions,
} from '../skills/skill-catalog'
import { resolveAgentsForRun } from '../standards/agents-resolver'

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
  readonly agentsRootInstruction: string | null
  readonly agentsScopedInstructions: readonly {
    scopeRelativeDir: string
    filePath: string
    content: string
  }[]
  readonly agentsResolvedFiles: readonly string[]
  readonly catalogSkills: readonly SkillDiscoveryItem[]
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
  agentsRootInstruction: null,
  agentsScopedInstructions: [],
  agentsResolvedFiles: [],
  catalogSkills: [],
  activation: EMPTY_ACTIVATION,
  activeSkills: [],
  warnings: [],
}

export async function loadAgentStandardsContext(
  projectPath: string | null,
  userText: string,
  settings: Settings,
  attachments: readonly PreparedAttachment[] = [],
): Promise<AgentStandardsContext> {
  if (!projectPath) {
    return EMPTY_STANDARDS_CONTEXT
  }

  const warnings: string[] = []
  const attachmentPathsInsideProject = attachments
    .map((attachment) => path.resolve(attachment.path))
    .filter((attachmentPath) => isPathInside(projectPath, attachmentPath))
  const candidatePaths = inferAgentsCandidatePaths({
    text: userText,
    attachmentPaths: attachmentPathsInsideProject,
  })
  const agentsResolution = await resolveAgentsForRun(projectPath, candidatePaths)
  warnings.push(...agentsResolution.warnings)

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

  const activeSkills: ActiveSkillInstruction[] = []
  for (const skillId of activation.selectedSkillIds) {
    try {
      const skill = await loadSkillInstructions(projectPath, skillId, toggles)
      if (!skill.enabled) {
        warnings.push(`Skill "${skillId}" is disabled and could not be activated.`)
        continue
      }

      activeSkills.push({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        body: skill.instructions,
        folderPath: skill.folderPath,
        skillPath: skill.skillPath,
        hasScripts: skill.hasScripts,
      })
    } catch (error) {
      warnings.push(
        `Failed to load active skill "${skillId}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  return {
    agentsPath: agentsResolution.root.filePath,
    agentsStatus: agentsResolution.root.status,
    agentsInstruction:
      agentsResolution.root.status === 'found' ? agentsResolution.root.content : null,
    agentsError: agentsResolution.root.error,
    agentsRootInstruction:
      agentsResolution.root.status === 'found' ? agentsResolution.root.content : null,
    agentsScopedInstructions: agentsResolution.scoped.map((scope) => ({
      scopeRelativeDir: scope.scopeRelativeDir,
      filePath: scope.filePath,
      content: scope.content,
    })),
    agentsResolvedFiles: [
      ...(agentsResolution.root.status === 'found' ? [agentsResolution.root.filePath] : []),
      ...agentsResolution.scoped.map((scope) => scope.filePath),
    ],
    catalogSkills: catalog.skills,
    activation: {
      explicitSkillIds: activation.explicitSkillIds,
      heuristicSkillIds: activation.heuristicSkillIds,
      selectedSkillIds: activation.selectedSkillIds,
    },
    activeSkills,
    warnings,
  }
}
