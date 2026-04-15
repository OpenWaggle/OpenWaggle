import { PROMPT_LIMITS } from '@shared/constants/text-processing'
import type { AgentPromptFragment } from './runtime-types'

const ORDER = 5
const ORDER_VALUE_6 = 6
const ORDER_VALUE_45 = 45
const ORDER_VALUE_44 = 44

export const agentsEntryPromptFragment: AgentPromptFragment = {
  id: 'standards.agents-entry',
  order: ORDER,
  build: (context) => {
    const instruction = context.standards?.agentsRootInstruction?.trim()
    return instruction && instruction.length > 0 ? instruction : null
  },
}

export const scopedAgentsPromptFragment: AgentPromptFragment = {
  id: 'standards.scoped-agents',
  order: ORDER_VALUE_6,
  build: (context) => {
    const scoped = context.standards?.agentsScopedInstructions ?? []
    if (scoped.length === 0) {
      return 'No additional nested AGENTS.md scopes were preloaded for this request. If you start working in a package/subdirectory, call the `loadAgents` tool for that path first.'
    }

    const listedScopes = scoped.slice(0, PROMPT_LIMITS.MAX_AGENTS_SCOPES)
    const overflowCount = scoped.length - listedScopes.length

    const sections = listedScopes.map((scope) =>
      [
        `Scope: ${scope.scopeRelativeDir}`,
        `- Source: ${scope.filePath}`,
        '- Precedence: this scope applies to files under this path and overrides broader parent rules.',
        'Instructions:',
        scope.content.trim(),
      ].join('\n'),
    )

    if (overflowCount > 0) {
      sections.push(
        `Additional scoped AGENTS.md files exist (${String(overflowCount)} more). Use loadAgents for target paths not yet covered.`,
      )
    }

    sections.push(
      'If you need instructions for a new file path not covered above, call the `loadAgents` tool first.',
    )

    return sections.join('\n\n')
  },
}

export const activeSkillsPromptFragment: AgentPromptFragment = {
  id: 'standards.active-skills',
  order: ORDER_VALUE_45,
  build: (context) => {
    const activeSkills = context.standards?.activeSkills ?? []
    if (activeSkills.length === 0) {
      return null
    }

    const sections = activeSkills.map((skill) => {
      const scriptsLine = skill.hasScripts
        ? `- Optional scripts are available under: ${skill.folderPath}/scripts`
        : '- No bundled scripts directory was found.'

      return [
        `Skill activated: ${skill.name} (${skill.id})`,
        `- Skill file: ${skill.skillPath}`,
        scriptsLine,
        'Skill instructions:',
        skill.body,
      ].join('\n')
    })

    return sections.join('\n\n')
  },
}

export const skillCatalogPromptFragment: AgentPromptFragment = {
  id: 'standards.skill-catalog',
  order: ORDER_VALUE_44,
  build: (context) => {
    const catalogSkills = context.standards?.catalogSkills ?? []
    const availableSkills = catalogSkills.filter(
      (skill) => skill.loadStatus === 'ok' && skill.enabled,
    )

    if (availableSkills.length === 0) {
      return null
    }

    const listedSkills = availableSkills.slice(0, PROMPT_LIMITS.MAX_SKILLS_IN_CATALOG)
    const remainingCount = availableSkills.length - listedSkills.length
    const lines = listedSkills.map((skill) => {
      const description =
        skill.description.length > PROMPT_LIMITS.MAX_SKILL_DESCRIPTION_CHARS
          ? `${skill.description.slice(0, PROMPT_LIMITS.MAX_SKILL_DESCRIPTION_CHARS)}...`
          : skill.description
      return `- ${skill.id}: ${description}`
    })
    const overflowLine =
      remainingCount > 0
        ? `- ... and ${String(remainingCount)} more available skills (use explicit /skill-id or loadSkill when needed).`
        : null
    return [
      'Available project skills (metadata only):',
      ...lines,
      ...(overflowLine ? [overflowLine] : []),
      'If a task needs skill-specific instructions, call the `loadSkill` tool before using that skill workflow.',
      'Do not assume details from skill names alone.',
    ].join('\n')
  },
}
