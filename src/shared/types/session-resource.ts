import type { SessionId } from './brand'

export type SessionResourceKind =
  | 'image'
  | 'file'
  | 'link'
  | 'tool'
  | 'web-search'
  | 'site'
  | 'commit'
  | 'change-request'

export type SessionResourceActivity = 'provided' | 'read' | 'created' | 'updated'

export type SessionResourceActor = 'user' | 'agent' | 'tool' | 'extension'

export interface SessionResourceOccurrence {
  readonly id: string
  readonly nodeId: string | null
  readonly branchId: string | null
  readonly actor: SessionResourceActor
  readonly activity: SessionResourceActivity
  readonly label: string | null
  /** Original path or URL observed for this exact use, before resource-level deduplication. */
  readonly locator: string | null
  readonly createdAt: number
}

export interface SessionResource {
  readonly id: string
  readonly sessionId: SessionId
  readonly canonicalKey: string
  readonly kind: SessionResourceKind
  readonly title: string
  readonly mimeType: string | null
  readonly locator: string | null
  /** Whether OpenWaggle has an immutable managed copy in addition to the original locator. */
  readonly managed: boolean
  readonly available: boolean
  readonly isSource: boolean
  readonly isOutput: boolean
  readonly occurrences: readonly SessionResourceOccurrence[]
  readonly createdAt: number
  readonly updatedAt: number
}

export interface SessionResourceList {
  readonly resources: SessionResource[]
  readonly backfillComplete: boolean
}

export type SessionResourceCatalogView =
  | 'all'
  | 'sources'
  | 'outputs'
  | 'images'
  | 'change-requests'

export const SESSION_RESOURCE_CATALOG_STALE_MESSAGE =
  'Session resource catalog changed; restart pagination.'

/** The Session workspace path currently rendered in chat. */
export interface SessionResourceRouteSelection {
  readonly branchId: string | null
  readonly pathNodeIds: readonly string[]
}

export interface SessionResourceCatalogPageRequest {
  readonly view: SessionResourceCatalogView
  readonly cursor?: string | null
  readonly limit: number
  readonly selection?: SessionResourceRouteSelection | null
}

export interface SessionResourceCatalogPage {
  readonly resources: readonly SessionResource[]
  /** Exact number of resources matching this view in the owning session. */
  readonly total: number
  readonly nextCursor: string | null
  /** Monotonic session catalog identity; changes after resources, occurrences, or branch order. */
  readonly orderRevision: string
}

export interface SessionResourceImageLocation {
  readonly resource: SessionResource
  readonly previous: SessionResource | null
  readonly next: SessionResource | null
  /** Zero-based position in the stable Session image ordering. */
  readonly index: number
  readonly total: number
  readonly orderRevision: string
}

export interface SessionResourceNodePageRequest {
  readonly nodeIds: readonly string[]
  readonly kind: SessionResourceKind | null
  readonly cursor?: string | null
  readonly limit: number
}

export interface SessionResourceBackfillStatus {
  readonly backfillComplete: boolean
  /** Whether this page durably advanced the historical projection cursor. */
  readonly progressed: boolean
}

export interface SessionResourceContent {
  readonly resourceId: string
  readonly fileName: string
  readonly mimeType: string
  readonly url: string
  readonly downloadUrl: string
}

/** A bounded renderer preview. Full Session resource bytes never cross IPC. */
export interface SessionResourceThumbnailPreview {
  readonly resourceId: string
  readonly fileName: string
  readonly mimeType: string
  readonly dataBase64: string
}

export interface RecordSessionChangeRequestInput {
  readonly title: string
  readonly url: string
}
