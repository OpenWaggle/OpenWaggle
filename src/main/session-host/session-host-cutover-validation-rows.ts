import { Schema, type SchemaType } from '@shared/schema'

/** Rows `session-host-cutover-validation.ts` reads from the target database. */
export const integrityRowSchema = Schema.Struct({ integrity_check: Schema.Unknown })
export const schemaRevisionRowSchema = Schema.Struct({ schema_revision: Schema.Unknown })

/** The semantic discovery state row; each column is compared with what the target expects. */
export const semanticStateRowSchema = Schema.Struct({
  status: Schema.Unknown,
  model_id: Schema.Unknown,
  model_revision: Schema.Unknown,
  dimensions: Schema.Unknown,
  prepared_count: Schema.Unknown,
  pending_count: Schema.Unknown,
})

export type SemanticStateRow = SchemaType<typeof semanticStateRowSchema>

export const transcriptStorageCountsSchema = Schema.Struct({
  nodes: Schema.Number,
  vector_bytes: Schema.Number,
  queued: Schema.Number,
})

/** Row counts of the target's canonical and derived tables. */
export interface TargetCounts {
  readonly sessions: number
  readonly nodes: number
  readonly bindings: number
  readonly indexedTitles: number
  readonly indexedProjects: number
  readonly indexedCatalogSessions: number
  readonly indexedNodes: number
  readonly indexedNodeRows: number
  readonly indexedTermDocuments: number
  readonly indexedDiscoverySessions: number
  readonly indexedDiscoverySessionRows: number
  readonly indexedDelegationObjectives: number
  readonly delegationSpecifications: number
  readonly semanticEmbeddings: number
  readonly semanticPending: number
  readonly transcriptSemanticScopes: number
  readonly transcriptSemanticEmbeddings: number
  readonly transcriptSemanticPending: number
  readonly transcriptSemanticLeases: number
}
