import { createHash } from 'node:crypto'
import { Schema } from '@shared/schema'
import { lenientOptional } from '@shared/schemas/lenient'
import { isRecord } from '@shared/utils/validation'
import { Option } from 'effect'
import type { ExternalMcpImportSource, PiMcpEntry } from './import-types'

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]),
  )
}

/** Identifies one server of one source file in one state; changes when the source entry changes. */
export function importFingerprint(input: {
  readonly source: ExternalMcpImportSource
  readonly sourcePath: string
  readonly name: string
  readonly entry: PiMcpEntry
}) {
  const entryHash = sha256(JSON.stringify(canonicalize(input.entry)))
  return sha256([input.source, input.sourcePath, input.name, entryHash].join('\u0000'))
}

const INVALID_NAME_CHARACTERS = /[^A-Za-z0-9_-]+/g
const EDGE_DASHES = /^-+|-+$/g
const FALLBACK_SERVER_NAME = 'server'

/** A server name Pi accepts: letters, digits, `_`, and `-`. */
export function piServerName(name: string) {
  return name.replace(INVALID_NAME_CHARACTERS, '-').replace(EDGE_DASHES, '') || FALLBACK_SERVER_NAME
}

/** Pi treats names that differ only in `-` and `_` as the same server. */
export function sameServerName(left: string, right: string) {
  return left.replace(/-/g, '_') === right.replace(/-/g, '_')
}

/** The provenance fields an earlier import wrote on a configured server (`McpImportProvenance`). */
const storedProvenanceSchema = Schema.Struct({
  provenance: lenientOptional(
    Schema.Struct({
      source: lenientOptional(Schema.String),
      sourcePath: lenientOptional(Schema.String),
      sourceName: lenientOptional(Schema.String),
      fingerprint: lenientOptional(Schema.String),
    }),
  ),
})

const decodeStoredProvenance = Schema.decodeUnknownOption(storedProvenanceSchema)

/** The provenance of a configured server, when an earlier import wrote one. */
export function storedImportProvenance(server: unknown) {
  return Option.getOrUndefined(decodeStoredProvenance(server))?.provenance
}

/** Whether a configured server is an earlier import of this server of this source file. */
export function isEarlierImportOf(
  server: unknown,
  candidate: { readonly source: string; readonly sourcePath: string; readonly name: string },
) {
  const provenance = storedImportProvenance(server)
  return (
    provenance?.source === candidate.source &&
    provenance.sourcePath === candidate.sourcePath &&
    provenance.sourceName === candidate.name
  )
}
