/**
 * Per-entry decisions for one OpenWaggle MCP file: is an entry an unchanged
 * copy of a live Pi entry (removed, leaving only an override), or does it stay
 * (converted to Pi's format)?
 */
import path from 'node:path'
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
  legacyServerIdentityKey,
} from './legacy-pi-import'
import { isUserDisabled, type LegacyStateFile } from './legacy-state'

export type McpServerMigrationAction = 'replaced-by-pi-entry' | 'converted' | 'disabled-by-state'

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
  /** The OpenWaggle file being migrated (the old state keys servers by it). */
  readonly filePath: string
  readonly state: LegacyStateFile
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
  return Object.fromEntries(Object.entries(entry).filter(([key]) => !keys.includes(key)))
}

function piProvenance(entry: JsonEntry) {
  const provenance = entry.provenance
  if (!isRecord(provenance) || provenance.source !== 'pi') return undefined
  const { sourcePath, fingerprint } = provenance
  if (typeof sourcePath !== 'string' || typeof fingerprint !== 'string') return undefined
  return { sourcePath, fingerprint }
}

function disabledInPiFile(config: Record<string, unknown>, name: string) {
  const openwaggle = config.openwaggle
  if (!isRecord(openwaggle) || !isRecord(openwaggle.disabledMcpServers)) return false
  return openwaggle.disabledMcpServers[name] !== undefined
}

function winningLowerLayer(context: EntryMigrationContext, name: string) {
  return context.lowerLayers.findLast((layer) => isFullEntry(layer.servers[name]))?.path
}

function decidePiCopy(
  name: string,
  entry: JsonEntry,
  context: EntryMigrationContext,
): PiCopyDecision {
  const provenance = piProvenance(entry)
  if (!provenance) return { kind: 'not-a-pi-copy' }
  const sourcePath = path.resolve(provenance.sourcePath)
  const config = context.livePiConfigs.get(sourcePath)
  if (!config) return { kind: 'kept', reason: `${provenance.sourcePath} is not read live here.` }
  const servers = isRecord(config.mcpServers) ? config.mcpServers : {}
  const piEntry = servers[name]
  if (!isFullEntry(piEntry) || disabledInPiFile(config, name)) {
    return { kind: 'kept', reason: `${provenance.sourcePath} no longer defines it.` }
  }
  const normalized = legacyNormalizeImportedServer(name, piEntry)
  const fingerprint = legacyImportFingerprint({
    source: 'pi',
    sourcePath: provenance.sourcePath,
    name,
    definition: normalized,
  })
  if (fingerprint !== provenance.fingerprint) {
    return { kind: 'kept', reason: `the entry in ${provenance.sourcePath} changed after import.` }
  }
  const copyHash = legacyDefinitionHash(withoutKeys(entry, ['provenance', 'directTools']))
  const sourceHash = legacyDefinitionHash(withoutKeys(normalized ?? {}, ['directTools']))
  if (copyHash !== sourceHash) return { kind: 'kept', reason: 'the copy was edited after import.' }
  if (winningLowerLayer(context, name) !== sourcePath) {
    return { kind: 'kept', reason: 'another file would define it instead of the Pi file.' }
  }
  return { kind: 'live', entry: piEntry }
}

export interface MigratedEntry {
  /** The entry to write, or undefined to remove the key. */
  readonly entry: unknown
  readonly change?: McpServerMigrationChange
}

/** Decide what one entry of an OpenWaggle MCP file becomes. */
export function migrateLegacyEntry(
  name: string,
  value: unknown,
  context: EntryMigrationContext,
): MigratedEntry {
  if (!isRecord(value)) return { entry: value }
  const serverState = context.state.servers[legacyServerIdentityKey(context.filePath, name)]
  const disabled = isUserDisabled(serverState) ? { enabled: false } : {}
  const decision = decidePiCopy(name, value, context)
  if (decision.kind === 'live') {
    const override = {
      ...directToolsOverride(value.directTools, liveExposureOf(decision.entry)),
      ...disabled,
    }
    const kept = Object.keys(override)
    return {
      entry: kept.length > 0 ? override : undefined,
      change: {
        server: name,
        action: 'replaced-by-pi-entry',
        details: kept.length > 0 ? [`kept as an override of ${kept.join(', ')}`] : [],
      },
    }
  }
  const converted = convertKeptLegacyEntry(value, {
    dropProvenance: piProvenance(value) !== undefined,
  })
  const entry = { ...converted.entry, ...disabled }
  const details = [
    ...(decision.kind === 'kept' ? [`kept because ${decision.reason}`] : []),
    ...converted.notes,
    ...(disabled.enabled === false ? ['disabled, as in the old settings'] : []),
  ]
  const changed = JSON.stringify(entry) !== JSON.stringify(value)
  return changed || details.length > 0
    ? { entry, change: { server: name, action: 'converted', details } }
    : { entry }
}
