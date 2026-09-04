import { match } from '@diegogbrisa/ts-match'
import { SessionId } from '@shared/types/brand'
import type {
  SessionResource,
  SessionResourceActivity,
  SessionResourceActor,
  SessionResourceKind,
  SessionResourceOccurrence,
} from '@shared/types/session-resource'

export interface SessionResourceRow {
  readonly id: string
  readonly session_id: string
  readonly canonical_key: string
  readonly kind: string
  readonly title: string
  readonly mime_type: string | null
  readonly locator: string | null
  readonly managed_path: string | null
  readonly available: number
  readonly created_at: number
  readonly updated_at: number
}

export interface SessionResourceOccurrenceRow {
  readonly id: string
  readonly resource_id: string
  readonly node_id: string | null
  readonly branch_id: string | null
  readonly actor: string
  readonly activity: string
  readonly label: string | null
  readonly created_at: number
}

function decodeKind(value: string): SessionResourceKind {
  return match(value)
    .with(
      'image',
      'file',
      'link',
      'tool',
      'web-search',
      'site',
      'commit',
      'change-request',
      (kind) => kind,
    )
    .otherwise(() => {
      throw new Error(`Unknown session resource kind "${value}".`)
    })
}

function decodeActor(value: string): SessionResourceActor {
  return match(value)
    .with('user', 'agent', 'tool', 'extension', (actor) => actor)
    .otherwise(() => {
      throw new Error(`Unknown session resource actor "${value}".`)
    })
}

function decodeActivity(value: string): SessionResourceActivity {
  return match(value)
    .with('provided', 'read', 'created', 'updated', (activity) => activity)
    .otherwise(() => {
      throw new Error(`Unknown session resource activity "${value}".`)
    })
}

function rowToOccurrence(row: SessionResourceOccurrenceRow): SessionResourceOccurrence {
  return {
    id: row.id,
    nodeId: row.node_id,
    branchId: row.branch_id,
    actor: decodeActor(row.actor),
    activity: decodeActivity(row.activity),
    label: row.label,
    createdAt: row.created_at,
  }
}

function normalizedLocator(locator: string | null) {
  if (!locator) return locator
  try {
    const url = new URL(locator)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
      ? url.href
      : locator
  } catch {
    return locator
  }
}

export function rowToResource(
  row: SessionResourceRow,
  occurrenceRows: readonly SessionResourceOccurrenceRow[],
): SessionResource {
  const occurrences = occurrenceRows.map(rowToOccurrence)
  return {
    id: row.id,
    sessionId: SessionId(row.session_id),
    canonicalKey: row.canonical_key,
    kind: decodeKind(row.kind),
    title: row.title,
    mimeType: row.mime_type,
    locator: normalizedLocator(row.locator),
    managed: row.managed_path !== null,
    available: row.available === 1,
    isSource: occurrences.some(
      (occurrence) => occurrence.activity === 'provided' || occurrence.activity === 'read',
    ),
    isOutput: occurrences.some(
      (occurrence) => occurrence.activity === 'created' || occurrence.activity === 'updated',
    ),
    occurrences,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
