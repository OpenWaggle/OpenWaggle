import { randomUUID } from 'node:crypto'
import {
  getPiWaggleProjectPresetsPath,
  getPiWaggleUserPresetsPath,
  readPiWagglePresetsFileData,
  writePiWagglePresetsFileData,
} from '@openwaggle/pi-waggle/preset-storage'
import { mergePiWagglePresetLayers } from '@openwaggle/pi-waggle/presets'
import { safeDecodeUnknown } from '@shared/schema'
import { wagglePresetSchema } from '@shared/schemas/waggle'
import { WagglePresetId } from '@shared/types/brand'
import { createWaggleModelBinding, type WagglePreset } from '@shared/types/waggle'
import { Effect, Layer } from 'effect'
import { createLogger } from '../logger'
import { WagglePresetsRepository } from '../ports/waggle-presets-repository'
import { BUILT_IN_WAGGLE_PRESETS } from './settings-waggle-presets-built-ins'

const logger = createLogger('waggle-presets-repository')

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
    id: WagglePresetId(preset.id),
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

async function readPresetState(filePath: string) {
  const data = await readPiWagglePresetsFileData(filePath)
  return {
    presets: hydratePresets(data.wagglePresets),
    hiddenBuiltInPresetIds: data.hiddenBuiltInPresetIds,
  }
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

async function readUserPresetState() {
  return readPresetState(getPiWaggleUserPresetsPath())
}

async function readProjectPresetState(projectPath?: string | null) {
  if (!projectPath) {
    return { presets: [], hiddenBuiltInPresetIds: [] }
  }

  return readPresetState(getPiWaggleProjectPresetsPath(projectPath))
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
  const nextPresets = scoped.presets.filter((existing) => existing.id !== saved.id)
  await scoped.write([...nextPresets, saved])
  return saved
}

async function deleteWagglePreset(id: WagglePresetId, projectPath?: string | null) {
  const scoped = await loadScopedPresets(projectPath)
  const nextPresets = scoped.presets.filter((preset) => preset.id !== id)
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
