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

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function rawPresetValues(value: unknown): readonly unknown[] {
  if (!isRecord(value) || !Array.isArray(value.wagglePresets)) {
    return []
  }

  return value.wagglePresets
}

function rawHiddenBuiltInIds(value: unknown): readonly string[] {
  if (!isRecord(value) || !Array.isArray(value.hiddenBuiltInPresetIds)) {
    return []
  }

  const ids: string[] = []
  for (const id of value.hiddenBuiltInPresetIds) {
    if (typeof id === 'string' && id.trim().length > 0) ids.push(id)
  }
  return ids
}

function parsePresetValues(rawPresets: readonly unknown[]): WagglePreset[] {
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
  agentDir = join(homedir(), PI_CONFIG_DIR, PI_AGENT_DIR),
): string {
  return join(agentDir, WAGGLE_PRESETS_FILE)
}

export function getPiWaggleProjectPresetsPath(projectPath: string): string {
  return join(projectPath, PI_CONFIG_DIR, WAGGLE_PRESETS_FILE)
}

export async function readPiWagglePresetsFileData(
  filePath: string,
): Promise<PiWagglePresetsFileData> {
  try {
    const raw = await readFile(filePath, 'utf-8')
    const parsed: unknown = raw.trim().length > 0 ? JSON.parse(raw) : {}
    return {
      wagglePresets: parsePresetValues(rawPresetValues(parsed)),
      hiddenBuiltInPresetIds: uniqueStrings(rawHiddenBuiltInIds(parsed)),
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { wagglePresets: [], hiddenBuiltInPresetIds: [] }
    }
    throw error
  }
}

export async function readPiWagglePresetsFile(filePath: string): Promise<readonly WagglePreset[]> {
  return (await readPiWagglePresetsFileData(filePath)).wagglePresets
}

export async function writePiWagglePresetsFileData(
  filePath: string,
  data: PiWagglePresetsFileData,
): Promise<void> {
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

export async function writePiWagglePresetsFile(
  filePath: string,
  presets: readonly WagglePreset[],
): Promise<void> {
  await writePiWagglePresetsFileData(filePath, {
    wagglePresets: presets,
    hiddenBuiltInPresetIds: [],
  })
}
