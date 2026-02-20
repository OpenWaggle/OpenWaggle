import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  loadSkillCatalog,
  loadSkillInstructions,
  toSkillCatalogResult,
} from '../skills/skill-catalog'
import { loadAgentsInstruction } from '../standards/agents-loader'
import { getSettings, updateSettings } from '../store/settings'

const projectPathSchema = z.string().min(1)
const skillIdSchema = z.string().min(1)

export function registerSkillsHandlers(): void {
  ipcMain.handle('standards:get-status', async (_event, rawProjectPath: string) => {
    const projectPath = projectPathSchema.parse(rawProjectPath)
    const agents = await loadAgentsInstruction(projectPath)
    return {
      agents: agents.status,
      agentsPath: agents.filePath,
      error: agents.error,
    }
  })

  ipcMain.handle('skills:list', async (_event, rawProjectPath: string) => {
    const projectPath = projectPathSchema.parse(rawProjectPath)
    const settings = getSettings()
    const toggles = settings.skillTogglesByProject[projectPath] ?? {}
    const catalog = await loadSkillCatalog(projectPath, toggles)
    return toSkillCatalogResult(catalog)
  })

  ipcMain.handle(
    'skills:set-enabled',
    (_event, rawProjectPath: string, rawSkillId: string, enabled: boolean) => {
      const projectPath = projectPathSchema.parse(rawProjectPath)
      const skillId = skillIdSchema.parse(rawSkillId)

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

  ipcMain.handle(
    'skills:get-preview',
    async (_event, rawProjectPath: string, rawSkillId: string) => {
      const projectPath = projectPathSchema.parse(rawProjectPath)
      const skillId = skillIdSchema.parse(rawSkillId)

      const settings = getSettings()
      const toggles = settings.skillTogglesByProject[projectPath] ?? {}
      const skill = await loadSkillInstructions(projectPath, skillId, toggles)
      return { markdown: skill.instructions }
    },
  )
}
