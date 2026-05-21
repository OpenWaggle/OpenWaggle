import path from 'node:path'
import type { PreparedAttachment } from '@shared/types/agent'
import type { Settings } from '@shared/types/settings'
import type { SkillActivationResult, SkillDiscoveryItem } from '@shared/types/standards'
import { inferAgentsCandidatePaths } from '@shared/utils/agents-path-inference'
import { activateSkillsFromText } from '../skills/skill-activation'
import {
  type LoadedSkillCatalog,
  loadSkillCatalog,
  loadSkillInstructions,
} from '../skills/skill-catalog'
import { resolveAgentsForRun } from '../standards/agents-resolver'
import { isPathInside } from '../utils/paths'

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

function getAttachmentPathsInsideProject(
  projectPath: string,
  attachments: readonly PreparedAttachment[],
) {
  return attachments
    .map((attachment) => path.resolve(attachment.path))
    .filter((attachmentPath) => isPathInside(projectPath, attachmentPath))
}

async function loadCatalogWithWarnings(
  projectPath: string,
  toggles: Readonly<Record<string, boolean>>,
  warnings: string[],
) {
  try {
    return await loadSkillCatalog(projectPath, toggles)
  } catch (error) {
    warnings.push(
      `Failed to load skills catalog: ${error instanceof Error ? error.message : String(error)}`,
    )
    return { projectPath, skills: [] } satisfies LoadedSkillCatalog
  }
}

function addActivationWarnings(
  activation: ReturnType<typeof activateSkillsFromText>,
  catalog: LoadedSkillCatalog,
  warnings: string[],
) {
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
}

async function loadActiveSkills(input: {
  readonly projectPath: string
  readonly selectedSkillIds: readonly string[]
  readonly toggles: Readonly<Record<string, boolean>>
  readonly warnings: string[]
}) {
  const activeSkills: ActiveSkillInstruction[] = []
  for (const skillId of input.selectedSkillIds) {
    try {
      const skill = await loadSkillInstructions(input.projectPath, skillId, input.toggles)
      if (!skill.enabled) {
        input.warnings.push(`Skill "${skillId}" is disabled and could not be activated.`)
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
      input.warnings.push(
        `Failed to load active skill "${skillId}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return activeSkills
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
  const attachmentPathsInsideProject = getAttachmentPathsInsideProject(projectPath, attachments)
  const candidatePaths = inferAgentsCandidatePaths({
    text: userText,
    attachmentPaths: attachmentPathsInsideProject,
  })
  const agentsResolution = await resolveAgentsForRun(projectPath, candidatePaths)
  warnings.push(...agentsResolution.warnings)

  const toggles = settings.skillTogglesByProject[projectPath] ?? {}
  const catalog = await loadCatalogWithWarnings(projectPath, toggles, warnings)
  const activation = activateSkillsFromText(userText, catalog.skills)
  addActivationWarnings(activation, catalog, warnings)
  const activeSkills = await loadActiveSkills({
    projectPath,
    selectedSkillIds: activation.selectedSkillIds,
    toggles,
    warnings,
  })

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
