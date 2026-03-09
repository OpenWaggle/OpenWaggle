import { Schema } from '@shared/schema'
import type { SkillLoadToolResult } from '@shared/types/standards'
import { loadSkillInstructions, normalizeRequestedSkillId } from '../../skills/skill-catalog'
import type { ToolContext } from '../define-tool'
import { defineOpenWaggleTool } from '../define-tool'

const loadSkillInputSchema = Schema.Struct({
  skillId: Schema.String.pipe(
    Schema.minLength(1),
    Schema.annotations({ description: 'Skill id from .openwaggle/skills/<skill-id>' }),
  ),
})

export async function loadSkillForRun(
  context: ToolContext,
  requestedSkillId: string,
): Promise<SkillLoadToolResult> {
  let skillId: string
  try {
    skillId = normalizeRequestedSkillId(requestedSkillId)
  } catch (error) {
    return {
      ok: false,
      skillId: requestedSkillId.trim().toLowerCase(),
      alreadyLoaded: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  const loadedSkillIds = context.dynamicSkills?.loadedSkillIds
  const toggles = context.dynamicSkills?.toggles ?? {}
  const alreadyLoaded = loadedSkillIds?.has(skillId) ?? false

  try {
    const skill = await loadSkillInstructions(context.projectPath, skillId, toggles)
    if (!skill.enabled) {
      return {
        ok: false,
        skillId,
        alreadyLoaded,
        error: `Skill "${skillId}" is disabled for this project.`,
      }
    }

    loadedSkillIds?.add(skillId)

    return {
      ok: true,
      skillId: skill.id,
      name: skill.name,
      description: skill.description,
      instructions: skill.instructions,
      folderPath: skill.folderPath,
      skillPath: skill.skillPath,
      hasScripts: skill.hasScripts,
      alreadyLoaded,
      warning: alreadyLoaded
        ? `Skill "${skillId}" was already loaded earlier in this run.`
        : undefined,
    }
  } catch (error) {
    return {
      ok: false,
      skillId,
      alreadyLoaded,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export const loadSkillTool = defineOpenWaggleTool({
  name: 'loadSkill',
  description:
    'Load full instructions for a project skill from .openwaggle/skills/<skill-id>/SKILL.md. Use this when you need detailed skill workflow guidance during the current run.',
  inputSchema: loadSkillInputSchema,
  async execute(args, context) {
    const result = await loadSkillForRun(context, args.skillId)
    return JSON.stringify(result)
  },
})
