import { randomUUID } from 'node:crypto'
import { BUILT_IN_WAGGLE_PRESETS, type WagglePreset } from '@openwaggle/waggle-core'
import {
  getPiWaggleProjectPresetsPath,
  getPiWaggleUserPresetsPath,
  type PiWagglePresetsFileData,
  readPiWagglePresetsFileData,
  writePiWagglePresetsFileData,
} from './preset-storage'

const FIRST_DUPLICATE_PRESET_SUFFIX = 2

export type PiWagglePresetScope = 'built-in' | 'user' | 'project'
export type PiWaggleEditablePresetScope = Exclude<PiWagglePresetScope, 'built-in'>

export interface PiWagglePresetLayers {
  readonly builtIns: readonly WagglePreset[]
  readonly userPresets: readonly WagglePreset[]
  readonly projectPresets: readonly WagglePreset[]
  readonly userHiddenBuiltInPresetIds: readonly string[]
  readonly projectHiddenBuiltInPresetIds: readonly string[]
}

export interface PiWaggleResolvedPreset {
  readonly preset: WagglePreset
  readonly scope: PiWagglePresetScope
}

export interface PiWaggleHiddenBuiltInPreset {
  readonly preset: WagglePreset
  readonly scope: PiWaggleEditablePresetScope
}

function emptyFileData(): PiWagglePresetsFileData {
  return { wagglePresets: [], hiddenBuiltInPresetIds: [] }
}

function readPresetFileDataOrEmpty(filePath: string): Promise<PiWagglePresetsFileData> {
  return readPiWagglePresetsFileData(filePath).catch(emptyFileData)
}

export async function loadPiWagglePresetLayers(cwd?: string): Promise<PiWagglePresetLayers> {
  const userDataPromise = readPresetFileDataOrEmpty(getPiWaggleUserPresetsPath())
  const projectDataPromise = cwd
    ? readPresetFileDataOrEmpty(getPiWaggleProjectPresetsPath(cwd))
    : Promise.resolve(emptyFileData())
  const [userData, projectData] = await Promise.all([userDataPromise, projectDataPromise])

  return {
    builtIns: BUILT_IN_WAGGLE_PRESETS,
    userPresets: userData.wagglePresets,
    projectPresets: projectData.wagglePresets,
    userHiddenBuiltInPresetIds: userData.hiddenBuiltInPresetIds,
    projectHiddenBuiltInPresetIds: projectData.hiddenBuiltInPresetIds,
  }
}

function idSet(ids: readonly string[]) {
  return new Set(ids)
}

export function mergePiWagglePresetLayers(
  layers: PiWagglePresetLayers,
): readonly PiWaggleResolvedPreset[] {
  const hiddenBuiltIns = idSet([
    ...layers.userHiddenBuiltInPresetIds,
    ...layers.projectHiddenBuiltInPresetIds,
  ])
  const resolvedById = new Map<string, PiWaggleResolvedPreset>()

  for (const preset of layers.builtIns) {
    if (!hiddenBuiltIns.has(preset.id)) {
      resolvedById.set(preset.id, { preset, scope: 'built-in' })
    }
  }
  for (const preset of layers.userPresets) {
    resolvedById.set(preset.id, { preset, scope: 'user' })
  }
  for (const preset of layers.projectPresets) {
    resolvedById.set(preset.id, { preset, scope: 'project' })
  }

  return [...resolvedById.values()]
}

function sortPresetsByName(presets: readonly WagglePreset[]) {
  return [...presets].sort((left, right) => left.name.localeCompare(right.name))
}

function sortIds(ids: readonly string[]) {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right))
}

export function resolvedPresetsForUi(layers: PiWagglePresetLayers) {
  const merged = mergePiWagglePresetLayers(layers)
  return [...merged].sort((left, right) => left.preset.name.localeCompare(right.preset.name))
}

export function hiddenBuiltInPresetsForUi(layers: PiWagglePresetLayers) {
  const hidden: PiWaggleHiddenBuiltInPreset[] = []
  const projectHiddenIds = idSet(layers.projectHiddenBuiltInPresetIds)
  const userHiddenIds = idSet(layers.userHiddenBuiltInPresetIds)
  for (const preset of layers.builtIns) {
    if (projectHiddenIds.has(preset.id)) {
      hidden.push({ preset, scope: 'project' })
    }
    if (userHiddenIds.has(preset.id)) {
      hidden.push({ preset, scope: 'user' })
    }
  }
  return hidden.sort((left, right) => {
    const nameOrder = left.preset.name.localeCompare(right.preset.name)
    return nameOrder === 0 ? left.scope.localeCompare(right.scope) : nameOrder
  })
}

function slugifyPresetName(name: string) {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || `waggle-${randomUUID()}`
}

function nextUniquePresetId(baseId: string, existingIds: ReadonlySet<string>) {
  if (!existingIds.has(baseId)) {
    return baseId
  }

  let suffix = FIRST_DUPLICATE_PRESET_SUFFIX
  while (true) {
    const candidate = `${baseId}-${String(suffix)}`
    if (!existingIds.has(candidate)) {
      return candidate
    }
    suffix += 1
  }
}

function persistPathForScope(scope: PiWaggleEditablePresetScope, cwd?: string) {
  if (scope === 'user') {
    return getPiWaggleUserPresetsPath()
  }
  if (!cwd) {
    throw new Error('Project preset scope requires an active working directory')
  }
  return getPiWaggleProjectPresetsPath(cwd)
}

export function presetScopeLabel(scope: PiWaggleEditablePresetScope) {
  return scope === 'project'
    ? 'Project (.pi/waggle-presets.json)'
    : 'User (~/.pi/agent/waggle-presets.json)'
}

async function updatePresetFile(
  input: { readonly cwd?: string; readonly scope: PiWaggleEditablePresetScope },
  update: (data: PiWagglePresetsFileData) => PiWagglePresetsFileData,
) {
  const filePath = persistPathForScope(input.scope, input.cwd)
  const current = await readPiWagglePresetsFileData(filePath)
  await writePiWagglePresetsFileData(filePath, update(current))
}

export async function savePiWagglePreset(input: {
  readonly cwd?: string
  readonly scope: PiWaggleEditablePresetScope
  readonly preset: WagglePreset
}) {
  await updatePresetFile(input, (current) => ({
    ...current,
    wagglePresets: sortPresetsByName([
      ...current.wagglePresets.filter((preset) => preset.id !== input.preset.id),
      input.preset,
    ]),
  }))
}

export async function deletePiWaggleCustomPreset(input: {
  readonly cwd?: string
  readonly scope: PiWaggleEditablePresetScope
  readonly presetId: string
}) {
  await updatePresetFile(input, (current) => ({
    ...current,
    wagglePresets: current.wagglePresets.filter((preset) => preset.id !== input.presetId),
  }))
}

export async function suppressPiWaggleBuiltInPreset(input: {
  readonly cwd?: string
  readonly scope: PiWaggleEditablePresetScope
  readonly presetId: string
}) {
  await updatePresetFile(input, (current) => ({
    ...current,
    hiddenBuiltInPresetIds: sortIds([...current.hiddenBuiltInPresetIds, input.presetId]),
  }))
}

export async function restorePiWaggleBuiltInPreset(input: {
  readonly cwd?: string
  readonly scope: PiWaggleEditablePresetScope
  readonly presetId: string
}) {
  await updatePresetFile(input, (current) => ({
    ...current,
    hiddenBuiltInPresetIds: current.hiddenBuiltInPresetIds.filter((id) => id !== input.presetId),
  }))
}

export function buildEditablePreset(input: {
  readonly base: Omit<WagglePreset, 'id' | 'createdAt' | 'updatedAt' | 'isBuiltIn'>
  readonly existingId?: string
  readonly existingIds: ReadonlySet<string>
  readonly existingCreatedAt?: number
}) {
  const now = Date.now()
  const presetId = input.existingId
    ? input.existingId
    : nextUniquePresetId(slugifyPresetName(input.base.name), input.existingIds)

  return {
    id: presetId,
    name: input.base.name,
    description: input.base.description,
    config: input.base.config,
    isBuiltIn: false,
    createdAt: input.existingCreatedAt ?? now,
    updatedAt: now,
  } satisfies WagglePreset
}
