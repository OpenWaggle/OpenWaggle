import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import * as Effect from 'effect/Effect'
import { SettingsService } from '../services/settings-service'
import {
  loadSkillCatalog,
  loadSkillInstructions,
  toSkillCatalogResult,
} from '../skills/skill-catalog'

const projectPathSchema = Schema.String.pipe(Schema.minLength(1))
const skillIdSchema = Schema.String.pipe(Schema.minLength(1))

export function listSkillsOperation(rawProjectPath: string) {
  return Effect.gen(function* () {
    const projectPath = decodeUnknownOrThrow(projectPathSchema, rawProjectPath)
    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()
    const toggles = settings.skillTogglesByProject[projectPath] ?? {}
    const catalog = yield* Effect.promise(() => loadSkillCatalog(projectPath, toggles))
    return toSkillCatalogResult(catalog)
  })
}

export function setSkillEnabledOperation(
  rawProjectPath: string,
  rawSkillId: string,
  enabled: boolean,
) {
  return Effect.gen(function* () {
    const projectPath = decodeUnknownOrThrow(projectPathSchema, rawProjectPath)
    const skillId = decodeUnknownOrThrow(skillIdSchema, rawSkillId)
    const settingsService = yield* SettingsService
    if (settingsService.setSkillEnabled) {
      return yield* settingsService.setSkillEnabled(projectPath, skillId, enabled)
    }
    const settings = yield* settingsService.get()
    const nextSkillTogglesByProject = { ...settings.skillTogglesByProject }
    const projectToggles = { ...(nextSkillTogglesByProject[projectPath] ?? {}) }
    projectToggles[skillId] = enabled
    nextSkillTogglesByProject[projectPath] = projectToggles
    yield* settingsService.update({ skillTogglesByProject: nextSkillTogglesByProject })
  })
}

export function getSkillPreviewOperation(rawProjectPath: string, rawSkillId: string) {
  return Effect.gen(function* () {
    const projectPath = decodeUnknownOrThrow(projectPathSchema, rawProjectPath)
    const skillId = decodeUnknownOrThrow(skillIdSchema, rawSkillId)
    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()
    const toggles = settings.skillTogglesByProject[projectPath] ?? {}
    const skill = yield* Effect.promise(() => loadSkillInstructions(projectPath, skillId, toggles))
    return { markdown: skill.instructions }
  })
}
