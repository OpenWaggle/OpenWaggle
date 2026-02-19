import type { AgentPromptFragment } from './runtime-types'

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
