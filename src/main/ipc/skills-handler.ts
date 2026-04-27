import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import * as Effect from 'effect/Effect'
import { SettingsService } from '../services/settings-service'
import {
  loadSkillCatalog,
  loadSkillInstructions,
  toSkillCatalogResult,
} from '../skills/skill-catalog'
import { loadProjectAgentsInstruction } from '../standards/agents-loader'
import { resolveAgentsChainForPath, resolveAgentsForRun } from '../standards/agents-resolver'
import { typedHandle } from './typed-ipc'

const projectPathSchema = Schema.String.pipe(Schema.minLength(1))
const skillIdSchema = Schema.String.pipe(Schema.minLength(1))

export function registerSkillsHandlers(): void {
  typedHandle('standards:get-status', (_event, rawProjectPath: string) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawProjectPath)
      const agents = yield* Effect.promise(() => loadProjectAgentsInstruction(projectPath))
      return {
        agents: agents.status,
        agentsPath: agents.filePath,
        error: agents.error,
      }
    }),
  )

  typedHandle(
    'standards:get-effective-agents',
    (_event, rawProjectPath: string, rawTargetPath?: string) =>
      Effect.gen(function* () {
        const projectPath = decodeUnknownOrThrow(projectPathSchema, rawProjectPath)
        if (typeof rawTargetPath === 'string' && rawTargetPath.trim().length > 0) {
          return yield* Effect.promise(() => resolveAgentsChainForPath(projectPath, rawTargetPath))
        }
        return yield* Effect.promise(() => resolveAgentsForRun(projectPath, []))
      }),
  )

  typedHandle('skills:list', (_event, rawProjectPath: string) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawProjectPath)
      const settingsService = yield* SettingsService
      const settings = yield* settingsService.get()
      const toggles = settings.skillTogglesByProject[projectPath] ?? {}
      const catalog = yield* Effect.promise(() => loadSkillCatalog(projectPath, toggles))
      return toSkillCatalogResult(catalog)
    }),
  )

  typedHandle(
    'skills:set-enabled',
    (_event, rawProjectPath: string, rawSkillId: string, enabled: boolean) =>
      Effect.gen(function* () {
        const projectPath = decodeUnknownOrThrow(projectPathSchema, rawProjectPath)
        const skillId = decodeUnknownOrThrow(skillIdSchema, rawSkillId)

        const settingsService = yield* SettingsService
        const settings = yield* settingsService.get()
        const nextSkillTogglesByProject = { ...settings.skillTogglesByProject }
        const projectToggles = { ...(nextSkillTogglesByProject[projectPath] ?? {}) }
        projectToggles[skillId] = enabled
        nextSkillTogglesByProject[projectPath] = projectToggles

        yield* settingsService.update({
          skillTogglesByProject: nextSkillTogglesByProject,
        })
      }),
  )

  typedHandle('skills:get-preview', (_event, rawProjectPath: string, rawSkillId: string) =>
    Effect.gen(function* () {
      const projectPath = decodeUnknownOrThrow(projectPathSchema, rawProjectPath)
      const skillId = decodeUnknownOrThrow(skillIdSchema, rawSkillId)

      const settingsService = yield* SettingsService
      const settings = yield* settingsService.get()
      const toggles = settings.skillTogglesByProject[projectPath] ?? {}
      const skill = yield* Effect.promise(() =>
        loadSkillInstructions(projectPath, skillId, toggles),
      )
      return { markdown: skill.instructions }
    }),
  )
}
