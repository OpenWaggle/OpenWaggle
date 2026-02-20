import type { AgentPromptFragment } from './runtime-types'

const MAX_SKILLS_IN_CATALOG_PROMPT = 20
const MAX_SKILL_DESCRIPTION_CHARS = 140

export const agentsEntryPromptFragment: AgentPromptFragment = {
  id: 'standards.agents-entry',
  order: 5,
  build: (context) => {
    const instruction = context.standards?.agentsInstruction?.trim()
    return instruction && instruction.length > 0 ? instruction : null
  },
}

export const activeSkillsPromptFragment: AgentPromptFragment = {
  id: 'standards.active-skills',
  order: 45,
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
  order: 44,
  build: (context) => {
    const catalogSkills = context.standards?.catalogSkills ?? []
    const availableSkills = catalogSkills.filter(
      (skill) => skill.loadStatus === 'ok' && skill.enabled,
    )

    if (availableSkills.length === 0) {
      return null
    }

    const listedSkills = availableSkills.slice(0, MAX_SKILLS_IN_CATALOG_PROMPT)
    const remainingCount = availableSkills.length - listedSkills.length
    const lines = listedSkills.map((skill) => {
      const description =
        skill.description.length > MAX_SKILL_DESCRIPTION_CHARS
          ? `${skill.description.slice(0, MAX_SKILL_DESCRIPTION_CHARS)}...`
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
