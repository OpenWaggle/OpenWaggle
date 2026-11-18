import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseWagglePreset, type WagglePreset } from '@openwaggle/waggle-core'

const JSON_INDENT_SPACES = 2
const PI_CONFIG_DIR = '.pi'
const PI_AGENT_DIR = 'agent'
const WAGGLE_PRESETS_FILE = 'waggle-presets.json'

export interface PiWagglePresetsFileData {
  readonly wagglePresets: readonly WagglePreset[]
  readonly hiddenBuiltInPresetIds: readonly string[]
}

/** The presets file's fields, each still unchecked. */
interface UncheckedPresetsFile {
  readonly wagglePresets?: unknown
  readonly hiddenBuiltInPresetIds?: unknown
}

function presetsFileFields(value: unknown) {
  const file: UncheckedPresetsFile =
    typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}
  return file
}

function uniqueStrings(values: readonly string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function rawPresetValues(value: unknown) {
  const { wagglePresets } = presetsFileFields(value)
  const result: readonly unknown[] = Array.isArray(wagglePresets) ? wagglePresets : []
  return result
}

function rawHiddenBuiltInIds(value: unknown) {
  const { hiddenBuiltInPresetIds } = presetsFileFields(value)
  if (!Array.isArray(hiddenBuiltInPresetIds)) {
    const result: readonly string[] = []
    return result
  }

  const ids: string[] = []
  for (const id of hiddenBuiltInPresetIds) {
    if (typeof id === 'string' && id.trim().length > 0) ids.push(id)
  }
  return ids
}

function parsePresetValues(rawPresets: readonly unknown[]) {
  const presets: WagglePreset[] = []
  for (const rawPreset of rawPresets) {
    const result = parseWagglePreset(rawPreset)
    if (result.success) {
      presets.push(result.value)
    }
  }
  return presets
}

export function getPiWaggleUserPresetsPath(
  agentDir: string = join(homedir(), PI_CONFIG_DIR, PI_AGENT_DIR),
) {
  return join(agentDir, WAGGLE_PRESETS_FILE)
}

export function getPiWaggleProjectPresetsPath(projectPath: string) {
  return join(projectPath, PI_CONFIG_DIR, WAGGLE_PRESETS_FILE)
}

export async function readPiWagglePresetsFileData(filePath: string) {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed: unknown = raw.trim().length > 0 ? JSON.parse(raw) : {}
    const data: PiWagglePresetsFileData = {
      wagglePresets: parsePresetValues(rawPresetValues(parsed)),
      hiddenBuiltInPresetIds: uniqueStrings(rawHiddenBuiltInIds(parsed)),
    }
    return data
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      const data: PiWagglePresetsFileData = { wagglePresets: [], hiddenBuiltInPresetIds: [] }
      return data
    }
    throw error
  }
}

export async function readPiWagglePresetsFile(filePath: string) {
  return (await readPiWagglePresetsFileData(filePath)).wagglePresets
}

export async function writePiWagglePresetsFileData(
  filePath: string,
  data: PiWagglePresetsFileData,
) {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(
    filePath,
    `${JSON.stringify(
      {
        wagglePresets: data.wagglePresets,
        hiddenBuiltInPresetIds: uniqueStrings(data.hiddenBuiltInPresetIds),
      },
      null,
      JSON_INDENT_SPACES,
    )}\n`,
    'utf-8',
  )
}

export async function writePiWagglePresetsFile(filePath: string, presets: readonly WagglePreset[]) {
  await writePiWagglePresetsFileData(filePath, {
    wagglePresets: presets,
    hiddenBuiltInPresetIds: [],
  })
}
