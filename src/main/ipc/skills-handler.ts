import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import {
  loadSkillCatalog,
  loadSkillInstructions,
  toSkillCatalogResult,
} from '../skills/skill-catalog'
import { loadAgentsInstruction } from '../standards/agents-loader'
import { resolveAgentsChainForPath, resolveAgentsForRun } from '../standards/agents-resolver'
import { getSettings, updateSettings } from '../store/settings'
import { safeHandle } from './typed-ipc'

const projectPathSchema = Schema.String.pipe(Schema.minLength(1))
const skillIdSchema = Schema.String.pipe(Schema.minLength(1))

export function registerSkillsHandlers(): void {
  safeHandle('standards:get-status', async (_event, rawProjectPath: string) => {
    const projectPath = decodeUnknownOrThrow(projectPathSchema, rawProjectPath)
    const agents = await loadAgentsInstruction(projectPath)
    return {
      agents: agents.status,
      agentsPath: agents.filePath,
      error: agents.error,
    }
  })

  safeHandle(
    'standards:get-effective-agents',
    async (_event, rawProjectPath: string, rawTargetPath?: string) => {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawProjectPath)
      if (typeof rawTargetPath === 'string' && rawTargetPath.trim().length > 0) {
        return resolveAgentsChainForPath(projectPath, rawTargetPath)
      }
      return resolveAgentsForRun(projectPath, [])
    },
  )

  safeHandle('skills:list', async (_event, rawProjectPath: string) => {
    const projectPath = decodeUnknownOrThrow(projectPathSchema, rawProjectPath)
    const settings = getSettings()
    const toggles = settings.skillTogglesByProject[projectPath] ?? {}
    const catalog = await loadSkillCatalog(projectPath, toggles)
    return toSkillCatalogResult(catalog)
  })

  safeHandle(
    'skills:set-enabled',
    (_event, rawProjectPath: string, rawSkillId: string, enabled: boolean) => {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawProjectPath)
      const skillId = decodeUnknownOrThrow(skillIdSchema, rawSkillId)

      const settings = getSettings()
      const nextSkillTogglesByProject = { ...settings.skillTogglesByProject }
      const projectToggles = { ...(nextSkillTogglesByProject[projectPath] ?? {}) }
      projectToggles[skillId] = enabled
      nextSkillTogglesByProject[projectPath] = projectToggles

      updateSettings({
        skillTogglesByProject: nextSkillTogglesByProject,
      })
    },
  )

  safeHandle('skills:get-preview', async (_event, rawProjectPath: string, rawSkillId: string) => {
    const projectPath = decodeUnknownOrThrow(projectPathSchema, rawProjectPath)
    const skillId = decodeUnknownOrThrow(skillIdSchema, rawSkillId)

    const settings = getSettings()
    const toggles = settings.skillTogglesByProject[projectPath] ?? {}
    const skill = await loadSkillInstructions(projectPath, skillId, toggles)
    return { markdown: skill.instructions }
  })
}
