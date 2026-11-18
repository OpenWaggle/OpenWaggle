import { decodeUnknownOrThrow, Schema, type SchemaType } from '@shared/schema'
import { jsonValueSchema } from '@shared/schemas/validation'
import type { JsonObject, JsonValue } from '@shared/types/json'

const setting = Schema.optionalWith(jsonValueSchema, { exact: true })

/**
 * The Pi settings (`settings.json`, and the `pi` key of `.openwaggle/settings.json`) OpenWaggle
 * reads or rewrites. Pi owns the file and may hold any other setting, which is kept as written;
 * these stay JSON values because each reader checks the shape it needs, as Pi does.
 */
const piSettingsFieldsSchema = Schema.Struct({
  packages: setting,
  skills: setting,
  extensions: setting,
  prompts: setting,
  themes: setting,
  defaultTools: setting,
  cacheWarming: setting,
  compaction: setting,
  defaultProvider: setting,
  enabledModels: setting,
  modelThinkingLevels: setting,
})

export type PiSettingsFields = SchemaType<typeof piSettingsFieldsSchema>

type PiSettingName = keyof PiSettingsFields

export function piSettingsFields(settings: JsonObject) {
  const fields: PiSettingsFields = decodeUnknownOrThrow(piSettingsFieldsSchema, settings)
  return fields
}

/** The settings with these changed: a value replaces a setting, `undefined` removes it. */
export function withPiSettings(
  settings: JsonObject,
  changes: Partial<Record<PiSettingName, JsonValue | undefined>>,
) {
  const next: JsonObject = { ...settings }
  for (const [name, value] of Object.entries(changes)) {
    if (value === undefined) delete next[name]
    else next[name] = value
  }
  return next
}

const packageSourceSchema = Schema.Struct({ source: Schema.String })

/** A `packages` entry's source: the entry itself, or the `source` of an object entry. */
export function piPackageSource(value: JsonValue) {
  if (typeof value === 'string') {
    const result: string | null = value
    return result
  }
  const result: string | null = Schema.is(packageSourceSchema)(value) ? value.source : null
  return result
}

const compactionFieldsSchema = Schema.Struct({ modelOverrides: setting })

/** The `compaction` settings OpenWaggle reads. */
export function piCompactionFields(compaction: JsonObject) {
  return decodeUnknownOrThrow(compactionFieldsSchema, compaction)
}
