/**
 * Applying an import preview. The importer never writes files: it hands Pi
 * entries to the caller's config writer, which owns the target file.
 */
import { isRecord } from '@shared/utils/validation'
import { sameServerName } from './import-identity'
import type {
  ExternalMcpImportCandidate,
  ExternalMcpImportPreview,
  ExternalMcpImportSource,
  McpImportProvenance,
  McpImportTarget,
  PiMcpEntry,
} from './import-types'

export interface McpImportWrite {
  readonly name: string
  readonly entry: PiMcpEntry
  /** True when the entry replaces an existing server of that name. */
  readonly replace: boolean
}

export type McpImportWriter = (
  target: McpImportTarget,
  writes: readonly McpImportWrite[],
) => Promise<void>

export type McpImportConflictPolicy = 'skip' | 'replace' | 'rename'

export interface ApplyMcpImportsInput {
  readonly preview: ExternalMcpImportPreview
  readonly fingerprints: readonly string[]
  readonly target: McpImportTarget
  /** Servers currently in the target file. */
  readonly targetServers: Readonly<Record<string, unknown>>
  /** Names configured in the other MCP files; an import must not take one of them either. */
  readonly otherServerNames?: readonly string[]
  readonly conflictPolicy: McpImportConflictPolicy
  readonly now: () => Date
  readonly write: McpImportWriter
}

export interface ExternalMcpImportApplyResult {
  readonly imported: readonly {
    readonly source: ExternalMcpImportSource
    readonly sourceName: string
    readonly targetName: string
    readonly fingerprint: string
  }[]
  readonly skipped: readonly { readonly fingerprint: string; readonly reason: string }[]
}

const FIRST_RENAME_SUFFIX = 2
const STALE_REASON = 'The source changed or disappeared after preview. Preview imports again.'

function existingName(names: readonly string[], name: string) {
  return names.find((candidate) => sameServerName(candidate, name))
}

/** The target entry an earlier import of this candidate wrote, if any. */
function earlierImportName(
  candidate: ExternalMcpImportCandidate,
  servers: Readonly<Record<string, unknown>>,
) {
  return Object.entries(servers).find(([, value]) => {
    const provenance = isRecord(value) && isRecord(value.provenance) ? value.provenance : undefined
    return (
      provenance?.source === candidate.source &&
      provenance.sourcePath === candidate.sourcePath &&
      provenance.sourceName === candidate.name
    )
  })?.[0]
}

function renamed(name: string, names: readonly string[]) {
  let suffix = FIRST_RENAME_SUFFIX
  while (existingName(names, `${name}-${String(suffix)}`)) suffix += 1
  return `${name}-${String(suffix)}`
}

type Placement =
  | { readonly kind: 'write'; readonly name: string; readonly replace: boolean }
  | { readonly kind: 'skip'; readonly reason: string }

function placementFor(
  candidate: ExternalMcpImportCandidate,
  names: readonly string[],
  servers: Readonly<Record<string, unknown>>,
  policy: McpImportConflictPolicy,
): Placement {
  if (candidate.entry.command === undefined && candidate.entry.url === undefined) {
    return { kind: 'skip', reason: candidate.warnings.at(-1) ?? 'No portable command or URL.' }
  }
  const taken = earlierImportName(candidate, servers) ?? existingName(names, candidate.targetName)
  if (!taken) return { kind: 'write', name: candidate.targetName, replace: false }
  if (policy === 'replace') return { kind: 'write', name: taken, replace: true }
  if (policy === 'rename')
    return { kind: 'write', name: renamed(candidate.targetName, names), replace: false }
  return {
    kind: 'skip',
    reason: `A server named ${candidate.targetName} already exists in the target configuration.`,
  }
}

export async function applyMcpImports(
  input: ApplyMcpImportsInput,
): Promise<ExternalMcpImportApplyResult> {
  const byFingerprint = new Map(
    input.preview.candidates.map((candidate) => [candidate.fingerprint, candidate]),
  )
  const names = [...Object.keys(input.targetServers), ...(input.otherServerNames ?? [])]
  const importedAt = input.now().toISOString()
  const writes: McpImportWrite[] = []
  const imported: ExternalMcpImportApplyResult['imported'][number][] = []
  const skipped: ExternalMcpImportApplyResult['skipped'][number][] = []
  for (const fingerprint of new Set(input.fingerprints)) {
    const candidate = byFingerprint.get(fingerprint)
    if (!candidate) {
      skipped.push({ fingerprint, reason: STALE_REASON })
      continue
    }
    const placement = placementFor(candidate, names, input.targetServers, input.conflictPolicy)
    if (placement.kind === 'skip') {
      skipped.push({ fingerprint, reason: placement.reason })
      continue
    }
    const provenance: McpImportProvenance = {
      source: candidate.source,
      sourcePath: candidate.sourcePath,
      sourceName: candidate.name,
      fingerprint,
      importedAt,
    }
    writes.push({
      name: placement.name,
      replace: placement.replace,
      entry: { ...candidate.entry, provenance },
    })
    if (!placement.replace) names.push(placement.name)
    imported.push({
      source: candidate.source,
      sourceName: candidate.name,
      targetName: placement.name,
      fingerprint,
    })
  }
  if (writes.length > 0) await input.write(input.target, writes)
  return { imported, skipped }
}
