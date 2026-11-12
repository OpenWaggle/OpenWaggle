/**
 * Pure conversion of pre-ADR-0051 OpenWaggle MCP server entries to Pi's
 * `mcpServers` entry format. No I/O and no hashing: the adapter decides which
 * entries are Pi copies and calls into these rules.
 */
import { Schema } from '@shared/schema'
import { isRecord } from '@shared/utils/validation'

export type JsonEntry = Record<string, unknown>

/** OpenWaggle-only fields that have no Pi meaning and are removed. */
const REMOVED_FIELDS = [
  'transport',
  'compatibility',
  'protocolVersion',
  'required',
  'security',
  'clientCapabilities',
  'directTools',
  'auth',
  // Trust and sandbox leftovers; the old code kept these in state.json, but a
  // hand-edited file may carry them.
  'trusted',
  'trustedConfigHash',
  'allowUnsandboxed',
  'permissions',
  'sandbox',
] as const

/** Where the replacement of a removed legacy field goes, so converted keys keep their position. */
const REPLACEMENT_KEYS: Readonly<Record<string, readonly string[]>> = {
  transport: ['type'],
  compatibility: ['type'],
  auth: ['oauth'],
  directTools: ['exposure', 'toolExposure'],
}

/** Removed fields that are converted or expected, so they are not reported one by one. */
const SILENTLY_REMOVED = new Set(['provenance', 'directTools', 'auth', 'transport'])

const PI_EXPOSURES = new Set(['codemode', 'deferred', 'direct', 'hidden'])
const EXPOSURE_ALIASES: Readonly<Record<string, string>> = { 'codemode-deferred': 'codemode' }

/**
 * The members of a legacy entry these rules read, each still unchecked. A `JsonEntry` satisfies
 * it; the rules narrow each member where they read it and keep every other member as written.
 */
interface LegacyEntryFields {
  readonly command?: unknown
  readonly url?: unknown
  readonly type?: unknown
  readonly exposure?: unknown
  readonly toolExposure?: unknown
  readonly transport?: unknown
  readonly compatibility?: unknown
  readonly auth?: unknown
  readonly oauth?: unknown
  readonly directTools?: unknown
}

const legacyOAuthSchema = Schema.Struct({
  type: Schema.Literal('oauth'),
  clientMetadataUrl: Schema.optionalWith(Schema.Unknown, { exact: true }),
  scopes: Schema.optionalWith(Schema.Unknown, { exact: true }),
})

export interface LiveExposure {
  readonly exposure: string
  readonly toolExposure: Readonly<Record<string, string>>
}

export interface ConvertedEntry {
  readonly entry: JsonEntry
  readonly notes: readonly string[]
}

/** Pi treats an entry without `command`, `url`, or `type` as an override of an earlier file. */
export function isOverrideOnlyEntry(entry: LegacyEntryFields) {
  return entry.command === undefined && entry.url === undefined && entry.type === undefined
}

/** True when an entry defines a server (Pi's "full entry"). */
export function isFullEntry(value: unknown): value is JsonEntry {
  return isRecord(value) && !isOverrideOnlyEntry(value)
}

function resolveExposure(value: unknown) {
  if (typeof value !== 'string') return undefined
  const resolved = EXPOSURE_ALIASES[value] ?? value
  return PI_EXPOSURES.has(resolved) ? resolved : undefined
}

function exposureRecord(value: unknown) {
  if (!isRecord(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    const exposure = resolveExposure(entry)
    if (exposure) result[key] = exposure
  }
  return result
}

/** How Pi exposes a live entry's tools, ignoring fields Pi does not read (such as `directTools`). */
export function liveExposureOf(entry: LegacyEntryFields) {
  const result: LiveExposure = {
    exposure: resolveExposure(entry.exposure) ?? 'codemode',
    toolExposure: exposureRecord(entry.toolExposure),
  }
  return result
}

function directToolNames(directTools: unknown) {
  if (!Array.isArray(directTools)) return []
  return directTools.filter((name): name is string => typeof name === 'string' && name.length > 0)
}

function directToolExposure(names: readonly string[], base: Readonly<Record<string, string>>) {
  return { ...base, ...Object.fromEntries(names.map((name) => [name, 'direct'])) }
}

/**
 * The override that keeps the old `directTools` behaviour on top of a live Pi
 * entry. `true` becomes `exposure: "direct"`; a list of names becomes
 * `toolExposure` with those names `direct`, merged over the live entry's own
 * `toolExposure` because an override replaces that object as a whole.
 */
export function directToolsOverride(directTools: unknown, live: LiveExposure) {
  if (directTools === true) {
    const entry: JsonEntry = live.exposure === 'direct' ? {} : { exposure: 'direct' }
    return entry
  }
  const names = directToolNames(directTools).filter(
    (name) => (live.toolExposure[name] ?? live.exposure) !== 'direct',
  )
  if (names.length === 0) {
    const entry: JsonEntry = {}
    return entry
  }
  const entry: JsonEntry = { toolExposure: directToolExposure(names, live.toolExposure) }
  return entry
}

function legacyTransportType(entry: LegacyEntryFields) {
  if (entry.transport === 'sse' || entry.transport === 'websocket') return entry.transport
  if (entry.transport !== undefined) return undefined
  if (entry.compatibility === 'legacy-sse') return 'sse'
  if (entry.compatibility === 'legacy-websocket') return 'websocket'
  return undefined
}

function oauthFromLegacyAuth(entry: LegacyEntryFields, notes: string[]) {
  const auth = entry.auth
  if (auth === undefined) return undefined
  if (!isRecord(auth) || !Schema.is(legacyOAuthSchema)(auth)) {
    notes.push('auth was not an OpenWaggle OAuth setting and was removed.')
    return undefined
  }
  if (typeof auth.clientMetadataUrl === 'string') {
    notes.push(
      `auth.clientMetadataUrl ${auth.clientMetadataUrl} has no Pi equivalent and was removed.`,
    )
  }
  const scopes = Array.isArray(auth.scopes)
    ? auth.scopes.filter((scope): scope is string => typeof scope === 'string' && scope.length > 0)
    : []
  if (scopes.length === 0) return undefined
  const existing = isRecord(entry.oauth) ? entry.oauth : {}
  return { ...existing, scope: scopes.join(' ') }
}

function exposureFields(entry: LegacyEntryFields) {
  if (entry.directTools === true) {
    const result: JsonEntry = { exposure: 'direct' }
    return result
  }
  const names = directToolNames(entry.directTools)
  if (names.length === 0) {
    const result: JsonEntry = {}
    return result
  }
  const result: JsonEntry = {
    toolExposure: directToolExposure(names, exposureRecord(entry.toolExposure)),
  }
  return result
}

/**
 * Convert an entry that stays in OpenWaggle's file (an edited or orphaned Pi
 * copy, or a server that never came from Pi). Unknown fields are kept because
 * Pi ignores them; vault secret references stay because `.openwaggle` files
 * allow them. Key order is kept, with converted keys where their source was.
 */
export function convertKeptLegacyEntry(
  entry: JsonEntry,
  options: { readonly dropProvenance: boolean },
) {
  const notes: string[] = []
  const type = legacyTransportType(entry)
  const oauth = oauthFromLegacyAuth(entry, notes)
  const replacements: JsonEntry = {
    ...(type ? { type } : {}),
    ...(oauth ? { oauth } : {}),
    ...exposureFields(entry),
  }
  const removed = new Set<string>(REMOVED_FIELDS)
  if (options.dropProvenance) removed.add('provenance')
  const result: JsonEntry = {}
  const placed = new Set<string>()
  const place = (keys: readonly string[]) => {
    for (const key of keys) {
      if (placed.has(key) || !(key in replacements)) continue
      result[key] = replacements[key]
      placed.add(key)
    }
  }
  for (const [key, value] of Object.entries(entry)) {
    if (key in replacements) {
      place([key])
      continue
    }
    if (!removed.has(key)) {
      result[key] = value
      continue
    }
    place(REPLACEMENT_KEYS[key] ?? [])
    if (!SILENTLY_REMOVED.has(key) && !(key === 'compatibility' && type)) {
      notes.push(`${key} is OpenWaggle-only and was removed.`)
    }
  }
  place(Object.keys(replacements))
  const returned: ConvertedEntry = { entry: result, notes }
  return returned
}
