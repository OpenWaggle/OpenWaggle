/**
 * Per-entry decisions for one OpenWaggle MCP file: is an entry an unchanged
 * copy of a live Pi entry (removed, leaving only an override), or does it stay
 * (converted to Pi's format)?
 */
import path from 'node:path'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import { lenientOptional, lenientRecord } from '@shared/schemas/lenient'
import { jsonValueSchema } from '@shared/schemas/validation'
import { isRecord } from '@shared/utils/validation'
import {
  convertKeptLegacyEntry,
  directToolsOverride,
  isFullEntry,
  type JsonEntry,
  liveExposureOf,
} from '../../../domain/mcp/migration/legacy-entry-conversion'
import {
  legacyDefinitionHash,
  legacyImportFingerprint,
  legacyNormalizeImportedServer,
} from './legacy-pi-import'
import { mcpConfigServerMaps } from '../mcp-config-server-maps'

export type McpServerMigrationAction =
  | 'replaced-by-pi-entry'
  | 'converted'
  | 'disabled-by-state'
  | 'enabled-by-state'

export interface McpServerMigrationChange {
  readonly server: string
  readonly action: McpServerMigrationAction
  readonly details: readonly string[]
}

export interface McpLayerServers {
  readonly path: string
  readonly servers: Readonly<Record<string, unknown>>
}

export interface EntryMigrationContext {
  /** Pi files that the new loader reads live below this file, keyed by absolute path. */
  readonly livePiConfigs: ReadonlyMap<string, Record<string, unknown>>
  /** Files below this one in the merge order, lowest first, with their current servers. */
  readonly lowerLayers: readonly McpLayerServers[]
}

type PiCopyDecision =
  | { readonly kind: 'live'; readonly entry: JsonEntry }
  | { readonly kind: 'kept'; readonly reason: string }
  | { readonly kind: 'not-a-pi-copy' }

function withoutKeys(entry: Record<string, unknown>, keys: readonly string[]) {
  const omitted = new Set(keys)
  return Object.fromEntries(Object.entries(entry).filter(([key]) => !omitted.has(key)))
}

/** The fields of an OpenWaggle entry that tell a copy of a Pi entry from one written here. */
const legacyEntryFieldsSchema = Schema.Struct({
  provenance: lenientOptional(
    Schema.Struct({
      source: lenientOptional(Schema.String),
      sourcePath: lenientOptional(Schema.String),
      fingerprint: lenientOptional(Schema.String),
    }),
  ),
  /** Only the values that are `{ secret }` vault references. */
  env: lenientOptional(lenientRecord(Schema.Struct({ secret: Schema.String }))),
  headers: lenientOptional(lenientRecord(Schema.Struct({ secret: Schema.String }))),
  directTools: Schema.optionalWith(Schema.Unknown, { exact: true }),
})

const piConfigFieldsSchema = Schema.Struct({
  openwaggle: lenientOptional(
    Schema.Struct({
      disabledMcpServers: lenientOptional(
        Schema.Record({ key: Schema.String, value: jsonValueSchema }),
      ),
    }),
  ),
})

function legacyEntryFields(entry: JsonEntry) {
  return decodeUnknownOrThrow(legacyEntryFieldsSchema, entry)
}

function piProvenance(entry: JsonEntry) {
  const { provenance } = legacyEntryFields(entry)
  if (provenance?.source !== 'pi') return undefined
  const { sourcePath, fingerprint } = provenance
  if (sourcePath === undefined || fingerprint === undefined) return undefined
  return { sourcePath, fingerprint }
}

function disabledInPiFile(config: Record<string, unknown>, name: string) {
  const disabled = decodeUnknownOrThrow(piConfigFieldsSchema, config).openwaggle?.disabledMcpServers
  return disabled?.[name] !== undefined
}

/** Whether any `env` or `headers` value is a `{ secret }` vault reference. */
function holdsVaultSecret(entry: JsonEntry) {
  const { env, headers } = legacyEntryFields(entry)
  return [env, headers].some((references) => Object.keys(references ?? {}).length > 0)
}

function winningLowerLayer(context: EntryMigrationContext, name: string) {
  return context.lowerLayers.findLast((layer) => isFullEntry(layer.servers[name]))?.path
}

function decidePiCopy(name: string, entry: JsonEntry, context: EntryMigrationContext) {
  const provenance = piProvenance(entry)
  if (!provenance) {
    const decision: PiCopyDecision = { kind: 'not-a-pi-copy' }
    return decision
  }
  // The Pi entry reads those values from the environment, which a Dock-launched app may lack.
  if (holdsVaultSecret(entry)) {
    const decision: PiCopyDecision = {
      kind: 'kept',
      reason: 'the copy reads vault secrets, which the Pi entry does not.',
    }
    return decision
  }
  const sourcePath = path.resolve(provenance.sourcePath)
  const config = context.livePiConfigs.get(sourcePath)
  if (!config) {
    const decision: PiCopyDecision = {
      kind: 'kept',
      reason: `${provenance.sourcePath} is not read live here.`,
    }
    return decision
  }
  const servers = mcpConfigServerMaps(config).mcpServers ?? {}
  const piEntry = servers[name]
  if (!isFullEntry(piEntry) || disabledInPiFile(config, name)) {
    const decision: PiCopyDecision = {
      kind: 'kept',
      reason: `${provenance.sourcePath} no longer defines it.`,
    }
    return decision
  }
  const normalized = legacyNormalizeImportedServer(name, piEntry)
  const fingerprint = legacyImportFingerprint({
    source: 'pi',
    sourcePath: provenance.sourcePath,
    name,
    definition: normalized,
  })
  if (fingerprint !== provenance.fingerprint) {
    const decision: PiCopyDecision = {
      kind: 'kept',
      reason: `the entry in ${provenance.sourcePath} changed after import.`,
    }
    return decision
  }
  const copyHash = legacyDefinitionHash(withoutKeys(entry, ['provenance', 'directTools']))
  const sourceHash = legacyDefinitionHash(withoutKeys(normalized ?? {}, ['directTools']))
  if (copyHash !== sourceHash) {
    const decision: PiCopyDecision = { kind: 'kept', reason: 'the copy was edited after import.' }
    return decision
  }
  if (winningLowerLayer(context, name) !== sourcePath) {
    const decision: PiCopyDecision = {
      kind: 'kept',
      reason: 'another file would define it instead of the Pi file.',
    }
    return decision
  }
  const decision: PiCopyDecision = { kind: 'live', entry: piEntry }
  return decision
}

export interface MigratedEntry {
  /** The entry to write, or undefined to remove the key. */
  readonly entry: unknown
  readonly change?: McpServerMigrationChange
}

/** Decide what one entry of an OpenWaggle MCP file becomes. */
export function migrateLegacyEntry(name: string, value: unknown, context: EntryMigrationContext) {
  if (!isRecord(value)) {
    const result: MigratedEntry = { entry: value }
    return result
  }
  const decision = decidePiCopy(name, value, context)
  if (decision.kind === 'live') {
    const override = directToolsOverride(
      legacyEntryFields(value).directTools,
      liveExposureOf(decision.entry),
    )
    const kept = Object.keys(override)
    const result: MigratedEntry = {
      entry: kept.length > 0 ? override : undefined,
      change: {
        server: name,
        action: 'replaced-by-pi-entry',
        details: kept.length > 0 ? [`kept as an override of ${kept.join(', ')}`] : [],
      },
    }
    return result
  }
  const converted = convertKeptLegacyEntry(value, {
    dropProvenance: piProvenance(value) !== undefined,
  })
  const entry = converted.entry
  const details = [
    ...(decision.kind === 'kept' ? [`kept because ${decision.reason}`] : []),
    ...converted.notes,
  ]
  const changed = JSON.stringify(entry) !== JSON.stringify(value)
  const result: MigratedEntry =
    changed || details.length > 0
      ? { entry, change: { server: name, action: 'converted', details } }
      : { entry }
  return result
}
