import { decodeUnknownOrThrow } from '@shared/schema'
import { jsonObjectSchema } from '@shared/schemas/validation'
import type { JsonObject, JsonValue } from '@shared/types/json'
import type { PiCacheWarmingMode } from '@shared/types/settings'

/**
 * OpenWaggle settings that have a Pi equivalent. OpenWaggle stores them in its own Settings and
 * hands them to Pi in memory, layered under the user's Pi settings where Pi merges lists, so a Pi
 * file never records OpenWaggle's choice and standalone Pi keeps the user's own settings.
 */
export interface OpenWagglePiAppSettings {
  /** Offer Pi's `codemode` tool in every Session (`defaultTools: ["+codemode"]`). */
  readonly codemodeEnabled: boolean
  /** Pi's global `cacheWarming` setting. */
  readonly cacheWarming: PiCacheWarmingMode
}

const JSON_INDENT_SPACES = 2
const CODEMODE_DEFAULT_TOOL = '+codemode'

function parseSettings(content: string | undefined): JsonObject {
  if (!content || content.trim().length === 0) return {}
  const parsed: unknown = JSON.parse(content)
  return decodeUnknownOrThrow(jsonObjectSchema, parsed)
}

function serializeSettings(settings: JsonObject) {
  return `${JSON.stringify(settings, null, JSON_INDENT_SPACES)}\n`
}

function stringEntries(value: JsonValue | undefined): readonly JsonValue[] | undefined {
  return Array.isArray(value) ? value : undefined
}

/**
 * Pi resolves `defaultTools` in list order, so the OpenWaggle entry goes first: a Pi user's own
 * `-codemode`, in the same list or a project list, still turns codemode off.
 */
function defaultToolsWithCodemode(stored: JsonValue | undefined): JsonValue[] {
  const entries = stringEntries(stored) ?? []
  return [CODEMODE_DEFAULT_TOOL, ...entries]
}

/** The global Pi settings content Pi reads: OpenWaggle's choices applied, whatever is stored. */
export function withOpenWagglePiAppSettings(
  content: string | undefined,
  app: OpenWagglePiAppSettings,
): string {
  const settings = parseSettings(content)
  return serializeSettings({
    ...settings,
    ...(app.codemodeEnabled
      ? { defaultTools: defaultToolsWithCodemode(settings.defaultTools) }
      : {}),
    cacheWarming: app.cacheWarming,
  })
}

function sameJson(left: JsonValue | undefined, right: JsonValue | undefined) {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * The global Pi settings content Pi writes. A key Pi left exactly as OpenWaggle reported it gets
 * the stored value back (or is removed when nothing was stored); a key Pi changed keeps Pi's value.
 * `undefined` (Pi only read) stays `undefined`.
 */
export function withStoredPiAppSettings(
  stored: string | undefined,
  next: string | undefined,
  app: OpenWagglePiAppSettings,
): string | undefined {
  if (next === undefined) return undefined
  const settings = parseSettings(next)
  const storedSettings = parseSettings(stored)
  const reported = parseSettings(withOpenWagglePiAppSettings(stored, app))
  for (const key of ['defaultTools', 'cacheWarming'] as const) {
    if (!sameJson(settings[key], reported[key])) continue
    const storedValue = storedSettings[key]
    if (storedValue === undefined) delete settings[key]
    else settings[key] = storedValue
  }
  return serializeSettings(settings)
}
