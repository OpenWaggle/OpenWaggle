import { decodeUnknownOrThrow } from '@shared/schema'
import { jsonObjectSchema } from '@shared/schemas/validation'
import type { JsonObject } from '@shared/types/json'

/**
 * Pi labels the provider requests it can attribute (OpenRouter, NVIDIA NIM, Cloudflare) only
 * while its `enableInstallTelemetry` setting is on. OpenWaggle decides those labels itself, from
 * its own Usage statistics switch (provider-attribution-extension.ts), so the settings it hands Pi
 * always report the setting as on.
 *
 * The report exists in memory only. Every write restores the stored value, and a value that was
 * never stored stays absent, so neither `~/.pi/agent/settings.json` nor a project file records
 * OpenWaggle's choice and standalone Pi keeps the user's own setting.
 */
const INSTALL_TELEMETRY_SETTING = 'enableInstallTelemetry'
const JSON_INDENT_SPACES = 2

/** Invalid JSON throws, as in the rest of the storage, so Pi records it as a settings error. */
function parseSettings(content: string | undefined): JsonObject {
  if (!content || content.trim().length === 0) return {}
  const parsed: unknown = JSON.parse(content)
  return decodeUnknownOrThrow(jsonObjectSchema, parsed)
}

function serializeSettings(settings: JsonObject) {
  return `${JSON.stringify(settings, null, JSON_INDENT_SPACES)}\n`
}

/** The settings content Pi reads: install telemetry on, whatever is stored. */
export function withReportedInstallTelemetry(content: string | undefined) {
  return serializeSettings({ ...parseSettings(content), [INSTALL_TELEMETRY_SETTING]: true })
}

/**
 * The settings content Pi writes, with the install-telemetry value of `stored` put back where Pi
 * left the key, or the key removed when `stored` has none. `undefined` (Pi only read) stays
 * `undefined`.
 */
export function withStoredInstallTelemetry(
  stored: string | undefined,
  next: string | undefined,
): string | undefined {
  if (next === undefined) return undefined
  const settings = parseSettings(next)
  const storedValue = parseSettings(stored)[INSTALL_TELEMETRY_SETTING]
  // Assigned in place, so a stored key keeps its position in the user's file.
  if (storedValue === undefined) delete settings[INSTALL_TELEMETRY_SETTING]
  else settings[INSTALL_TELEMETRY_SETTING] = storedValue
  return serializeSettings(settings)
}
