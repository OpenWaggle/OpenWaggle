import { randomUUID } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  getPiWaggleProjectPresetsPath,
  getPiWaggleUserPresetsPath,
  readPiWagglePresetsFileData,
  writePiWagglePresetsFileData,
} from '@openwaggle/pi-waggle/preset-storage'
import { mergePiWagglePresetLayers } from '@openwaggle/pi-waggle/presets'
import { normalizeWagglePresetId } from '@openwaggle/waggle-core'
import { parseJsonUnknown, Schema, safeDecodeUnknown } from '@shared/schema'
import { wagglePresetSchema } from '@shared/schemas/waggle'
import { WagglePresetId } from '@shared/types/brand'
import { createWaggleModelBinding, type WagglePreset } from '@shared/types/waggle'
import { Effect, Layer } from 'effect'
import { app } from 'electron'
import { loadProjectConfig } from '../config/project-config'
import { createLogger } from '../logger'
import { WagglePresetsRepository } from '../ports/waggle-presets-repository'
import { BUILT_IN_WAGGLE_PRESETS } from './settings-waggle-presets-built-ins'

const GLOBAL_WAGGLE_PRESETS_FILE = 'waggle-presets.json'

const logger = createLogger('waggle-presets-repository')

const wagglePresetFileSchema = Schema.Struct({
  wagglePresets: Schema.optional(Schema.mutable(Schema.Array(wagglePresetSchema))),
})

interface ScopedWagglePresets {
  readonly hiddenBuiltInPresetIds: readonly string[]
  readonly presets: readonly WagglePreset[]
  readonly write: (presets: readonly WagglePreset[]) => Promise<void>
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function hydratePreset(raw: unknown): WagglePreset | null {
  const result = safeDecodeUnknown(wagglePresetSchema, raw)
  if (!result.success) {
    return null
  }

  const preset = result.data
  return {
    ...preset,
    id: WagglePresetId(normalizeWagglePresetId(preset.id)),
    config: {
      ...preset.config,
      agents: [
        {
          ...preset.config.agents[0],
          model: createWaggleModelBinding(preset.config.agents[0].model),
        },
        {
          ...preset.config.agents[1],
          model: createWaggleModelBinding(preset.config.agents[1].model),
        },
      ],
    },
  }
}

function hydratePresets(rawPresets: readonly unknown[] | undefined): WagglePreset[] {
  if (!rawPresets) {
    return []
  }

  const presets: WagglePreset[] = []
  for (const rawPreset of rawPresets) {
    const preset = hydratePreset(rawPreset)
    if (preset) {
      presets.push(preset)
    }
  }
  return presets
}

function isWagglePreset(value: WagglePreset | null): value is WagglePreset {
  return value !== null
}

function getLegacyGlobalPresetsPath() {
  return join(app.getPath('userData'), GLOBAL_WAGGLE_PRESETS_FILE)
}

async function fileExists(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

async function readJsonFile(filePath: string) {
  try {
    const raw = await readFile(filePath, 'utf-8')
    return raw.trim().length > 0 ? parseJsonUnknown(raw) : {}
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function readLegacyUserPresets() {
  const filePath = getLegacyGlobalPresetsPath()
  const parsed = await readJsonFile(filePath)
  if (!parsed) {
    return []
  }
  const decoded = safeDecodeUnknown(wagglePresetFileSchema, parsed)
  if (!decoded.success) {
    logger.warn('Failed to parse legacy user Waggle presets file, ignoring invalid presets', {
      filePath,
      issues: decoded.issues,
    })
    return []
  }
  return hydratePresets(decoded.data.wagglePresets)
}

async function readUserPresetState() {
  const filePath = getPiWaggleUserPresetsPath()
  if (await fileExists(filePath)) {
    const data = await readPiWagglePresetsFileData(filePath)
    return {
      presets: hydratePresets(data.wagglePresets),
      hiddenBuiltInPresetIds: data.hiddenBuiltInPresetIds,
    }
  }

  return { presets: await readLegacyUserPresets(), hiddenBuiltInPresetIds: [] }
}

async function writeUserPresets(
  presets: readonly WagglePreset[],
  hiddenBuiltInPresetIds: readonly string[],
) {
  await writePiWagglePresetsFileData(getPiWaggleUserPresetsPath(), {
    wagglePresets: presets,
    hiddenBuiltInPresetIds,
  })
}

async function readLegacyProjectPresets(projectPath: string) {
  const config = await loadProjectConfig(projectPath)
  return [...(config.wagglePresets ?? [])]
}

async function readProjectPresetState(projectPath?: string | null) {
  if (!projectPath) {
    return { presets: [], hiddenBuiltInPresetIds: [] }
  }

  const filePath = getPiWaggleProjectPresetsPath(projectPath)
  if (await fileExists(filePath)) {
    const data = await readPiWagglePresetsFileData(filePath)
    return {
      presets: hydratePresets(data.wagglePresets),
      hiddenBuiltInPresetIds: data.hiddenBuiltInPresetIds,
    }
  }

  return { presets: await readLegacyProjectPresets(projectPath), hiddenBuiltInPresetIds: [] }
}

async function writeProjectPresets(
  projectPath: string,
  presets: readonly WagglePreset[],
  hiddenBuiltInPresetIds: readonly string[],
) {
  await writePiWagglePresetsFileData(getPiWaggleProjectPresetsPath(projectPath), {
    wagglePresets: presets,
    hiddenBuiltInPresetIds,
  })
}

async function loadScopedPresets(projectPath?: string | null): Promise<ScopedWagglePresets> {
  if (projectPath) {
    const state = await readProjectPresetState(projectPath)
    return {
      ...state,
      write: (presets: readonly WagglePreset[]) =>
        writeProjectPresets(projectPath, presets, state.hiddenBuiltInPresetIds),
    }
  }

  const state = await readUserPresetState()
  return {
    ...state,
    write: (presets: readonly WagglePreset[]) =>
      writeUserPresets(presets, state.hiddenBuiltInPresetIds),
  }
}

function validatePresetForSave(preset: WagglePreset): WagglePreset {
  const hydrated = hydratePreset(preset)
  if (!hydrated) {
    throw new Error('Invalid Waggle preset. Select a model for each agent or use $inherit.')
  }
  return hydrated
}

function normalizeSavedPreset(preset: WagglePreset): WagglePreset {
  const now = Date.now()
  const validatedPreset = validatePresetForSave(preset)
  return {
    ...validatedPreset,
    id: String(validatedPreset.id).trim() ? validatedPreset.id : WagglePresetId(randomUUID()),
    isBuiltIn: false,
    createdAt: validatedPreset.createdAt > 0 ? validatedPreset.createdAt : now,
    updatedAt: now,
  }
}

async function listWagglePresets(projectPath?: string | null) {
  const [userState, projectState] = await Promise.all([
    readUserPresetState().catch((error) => {
      logger.warn('Failed to read user Waggle presets', { error: describeError(error) })
      return { presets: [], hiddenBuiltInPresetIds: [] }
    }),
    readProjectPresetState(projectPath).catch((error) => {
      logger.warn('Failed to read project Waggle presets', {
        projectPath,
        error: describeError(error),
      })
      return { presets: [], hiddenBuiltInPresetIds: [] }
    }),
  ])

  return mergePiWagglePresetLayers({
    builtIns: BUILT_IN_WAGGLE_PRESETS,
    userPresets: userState.presets,
    projectPresets: projectState.presets,
    userHiddenBuiltInPresetIds: userState.hiddenBuiltInPresetIds,
    projectHiddenBuiltInPresetIds: projectState.hiddenBuiltInPresetIds,
  })
    .map((entry) => hydratePreset(entry.preset))
    .filter(isWagglePreset)
}

async function saveWagglePreset(preset: WagglePreset, projectPath?: string | null) {
  const scoped = await loadScopedPresets(projectPath)
  const saved = normalizeSavedPreset(preset)
  const nextPresets = scoped.presets.filter(
    (existing) => normalizeWagglePresetId(existing.id) !== normalizeWagglePresetId(saved.id),
  )
  await scoped.write([...nextPresets, saved])
  return saved
}

async function deleteWagglePreset(id: WagglePresetId, projectPath?: string | null) {
  const scoped = await loadScopedPresets(projectPath)
  const nextPresets = scoped.presets.filter(
    (preset) => normalizeWagglePresetId(preset.id) !== normalizeWagglePresetId(id),
  )
  await scoped.write(nextPresets)
}

export const SettingsWagglePresetsRepositoryLive = Layer.succeed(
  WagglePresetsRepository,
  WagglePresetsRepository.of({
    list: (projectPath) => Effect.promise(() => listWagglePresets(projectPath)),
    save: (preset, projectPath) => Effect.promise(() => saveWagglePreset(preset, projectPath)),
    delete: (id, projectPath) => Effect.promise(() => deleteWagglePreset(id, projectPath)),
  }),
)
