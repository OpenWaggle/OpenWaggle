import type { DatabaseSync } from 'node:sqlite'
import { SESSION_TRANSCRIPT_SEMANTIC_STORAGE_POLICY as TRANSCRIPT_POLICY } from '../domain/session-transcript-semantic-storage-policy'
import { queryCutoverRecord, readCutoverCount } from './session-host-cutover-database'

export const SESSION_HOST_SCHEMA_REVISION = 5

interface TargetCounts {
  readonly sessions: number
  readonly nodes: number
  readonly bindings: number
  readonly indexedTitles: number
  readonly indexedNodes: number
  readonly indexedDiscoveryNodes: number
  readonly indexedDelegationObjectives: number
  readonly delegationSpecifications: number
  readonly semanticEmbeddings: number
  readonly semanticPending: number
  readonly transcriptSemanticScopes: number
  readonly transcriptSemanticEmbeddings: number
  readonly transcriptSemanticPending: number
  readonly transcriptSemanticLeases: number
}

function validateDatabaseIntegrity(database: DatabaseSync) {
  const integrity = queryCutoverRecord(database, 'PRAGMA integrity_check')?.integrity_check
  if (integrity !== 'ok') {
    throw new Error(`Session Host target integrity check failed: ${String(integrity)}`)
  }
  if (database.prepare('PRAGMA foreign_key_check').all().length > 0) {
    throw new Error('Session Host target contains foreign-key failures.')
  }
  const schemaRevision = queryCutoverRecord(
    database,
    'SELECT schema_revision FROM session_host_schema_metadata WHERE singleton = 1',
  )?.schema_revision
  if (schemaRevision !== SESSION_HOST_SCHEMA_REVISION) {
    throw new Error('Session Host target metadata is missing or incompatible.')
  }
}

function targetCounts(database: DatabaseSync): TargetCounts {
  return {
    sessions: readCutoverCount(database, 'sessions'),
    nodes: readCutoverCount(database, 'session_nodes'),
    bindings: readCutoverCount(database, 'session_workspace_bindings'),
    indexedTitles: readCutoverCount(database, 'session_title_search'),
    indexedNodes: readCutoverCount(database, 'session_node_search'),
    indexedDiscoveryNodes: readCutoverCount(database, 'session_node_discovery_search'),
    indexedDelegationObjectives: readCutoverCount(database, 'session_delegation_search'),
    delegationSpecifications: readCutoverCount(database, 'delegation_specifications'),
    semanticEmbeddings: readCutoverCount(database, 'session_discovery_embeddings'),
    semanticPending: readCutoverCount(database, 'session_discovery_embedding_queue'),
    transcriptSemanticScopes: readCutoverCount(database, 'session_transcript_semantic_scopes'),
    transcriptSemanticEmbeddings: readCutoverCount(database, 'session_transcript_embeddings'),
    transcriptSemanticPending: readCutoverCount(database, 'session_transcript_embedding_queue'),
    transcriptSemanticLeases: readCutoverCount(database, 'session_transcript_semantic_leases'),
  }
}

function validateCanonicalCoverage(counts: TargetCounts, invalidProfiles: unknown) {
  if (counts.bindings !== counts.sessions) {
    throw new Error('Every migrated Session must have one Workspace binding.')
  }
  if (
    counts.indexedTitles !== counts.sessions ||
    counts.indexedNodes !== counts.nodes ||
    counts.indexedDiscoveryNodes !== counts.nodes
  ) {
    throw new Error('Session Host lexical search coverage does not match canonical data.')
  }
  if (counts.indexedDelegationObjectives !== counts.delegationSpecifications) {
    throw new Error('Session Host Delegation discovery coverage does not match canonical data.')
  }
  if (invalidProfiles !== 0) {
    throw new Error('Session Host target contains invalid execution profiles.')
  }
}

function validateSemanticCoverage(input: {
  readonly counts: TargetCounts
  readonly state: Record<string, unknown> | undefined
  readonly model?: { readonly id: string; readonly revision: string; readonly dimensions: number }
  readonly requireComplete: boolean
}) {
  if (input.requireComplete) {
    const complete =
      input.counts.semanticEmbeddings === input.counts.sessions &&
      input.counts.semanticPending === 0 &&
      input.state?.status === 'ready' &&
      input.state.prepared_count === input.counts.sessions &&
      input.state.pending_count === 0
    if (!complete) throw new Error('Session Host semantic discovery coverage is incomplete.')
  }
  if (!input.model || !input.state) return
  const compatible =
    input.state.model_id === input.model.id &&
    input.state.model_revision === input.model.revision &&
    input.state.dimensions === input.model.dimensions
  if (!compatible) {
    throw new Error('Session Host semantic discovery model revision is incompatible.')
  }
}

function validateRecoverableSemanticCoverage(database: DatabaseSync) {
  const unrecoverable = queryCutoverRecord(
    database,
    `SELECT COUNT(*) AS count
      FROM sessions
      LEFT JOIN session_discovery_embeddings AS embeddings
        ON embeddings.session_id = sessions.id
      LEFT JOIN session_discovery_embedding_queue AS queue
        ON queue.session_id = sessions.id
      WHERE embeddings.session_id IS NULL AND queue.session_id IS NULL`,
  )?.count
  if (unrecoverable !== 0) {
    throw new Error('Session Host semantic discovery coverage cannot be recovered from its queue.')
  }
}

function validateSemanticVectors(
  database: DatabaseSync,
  semanticModel?: { readonly id: string; readonly revision: string; readonly dimensions: number },
) {
  const invalidVectors = queryCutoverRecord(
    database,
    `SELECT COUNT(*) AS count FROM session_discovery_embeddings
      WHERE length(vector) <> dimensions * 4`,
  )?.count
  if (invalidVectors !== 0) {
    throw new Error('Session Host semantic discovery vectors are invalid.')
  }
  if (!semanticModel) return
  const incompatibleVectors = queryCutoverRecord(
    database,
    `SELECT COUNT(*) AS count FROM session_discovery_embeddings
      WHERE model_id <> ? OR model_revision <> ? OR dimensions <> ?`,
    semanticModel.id,
    semanticModel.revision,
    String(semanticModel.dimensions),
  )?.count
  if (incompatibleVectors !== 0) {
    throw new Error('Session Host semantic discovery model revision is incompatible.')
  }
}

interface TranscriptStorageCounts extends Record<string, unknown> {
  readonly nodes: number
  readonly vector_bytes: number
  readonly queued: number
}

function isTranscriptStorageCounts(
  value: Record<string, unknown> | undefined,
): value is TranscriptStorageCounts {
  return (
    typeof value?.nodes === 'number' &&
    typeof value.vector_bytes === 'number' &&
    typeof value.queued === 'number'
  )
}

function validateTranscriptStorageBudget(database: DatabaseSync) {
  const storage = queryCutoverRecord(
    database,
    `SELECT
      (SELECT COUNT(*) FROM (
        SELECT node_id FROM session_transcript_embeddings
        UNION SELECT node_id FROM session_transcript_embedding_queue
      )) AS nodes,
      (SELECT COALESCE(SUM(length(vector)), 0) FROM session_transcript_embeddings)
        + (SELECT COALESCE(SUM(scopes.vector_bytes_per_node), 0)
          FROM session_transcript_embedding_queue AS queue
          JOIN session_transcript_semantic_scopes AS scopes
            ON scopes.session_id = queue.session_id) AS vector_bytes,
      (SELECT COUNT(*) FROM session_transcript_embedding_queue) AS queued`,
  )
  if (!isTranscriptStorageCounts(storage)) {
    throw new Error('Session Host semantic transcript storage exceeds its durable budget.')
  }
  const withinBudget =
    storage.nodes <= TRANSCRIPT_POLICY.totalNodeLimit &&
    storage.vector_bytes <= TRANSCRIPT_POLICY.vectorByteLimit &&
    storage.queued <= TRANSCRIPT_POLICY.queuedNodeLimit
  if (!withinBudget) {
    throw new Error('Session Host semantic transcript storage exceeds its durable budget.')
  }
}

function validateTranscriptModel(
  database: DatabaseSync,
  semanticModel?: { readonly id: string; readonly revision: string; readonly dimensions: number },
) {
  if (!semanticModel) return
  const incompatibleVectors = queryCutoverRecord(
    database,
    `SELECT COUNT(*) AS count FROM session_transcript_embeddings
      WHERE model_id <> ? OR model_revision <> ? OR dimensions <> ?`,
    semanticModel.id,
    semanticModel.revision,
    String(semanticModel.dimensions),
  )?.count
  if (incompatibleVectors !== 0) {
    throw new Error('Session Host semantic transcript model revision is incompatible.')
  }
}

function validateTranscriptSemanticProjection(
  database: DatabaseSync,
  semanticModel?: { readonly id: string; readonly revision: string; readonly dimensions: number },
) {
  const unrecoverable = queryCutoverRecord(
    database,
    `SELECT COUNT(*) AS count
      FROM session_transcript_semantic_scopes AS scopes
      JOIN session_nodes AS nodes ON nodes.session_id = scopes.session_id
      JOIN session_node_search AS search
        ON search.node_id = nodes.id AND trim(search.content) <> ''
      LEFT JOIN session_transcript_embeddings AS embeddings ON embeddings.node_id = nodes.id
      LEFT JOIN session_transcript_embedding_queue AS queue ON queue.node_id = nodes.id
      WHERE embeddings.node_id IS NULL AND queue.node_id IS NULL
        AND scopes.coverage_limited = 0`,
  )?.count
  if (unrecoverable !== 0) {
    throw new Error('Session Host semantic transcript coverage cannot be recovered from its queue.')
  }
  const invalidVectors = queryCutoverRecord(
    database,
    `SELECT COUNT(*) AS count FROM session_transcript_embeddings
      WHERE length(vector) <> dimensions * 4`,
  )?.count
  if (invalidVectors !== 0) {
    throw new Error('Session Host semantic transcript vectors are invalid.')
  }
  const invalidScopes = queryCutoverRecord(
    database,
    `SELECT COUNT(*) AS count FROM session_transcript_semantic_scopes
      WHERE last_accessed_at < requested_at OR expires_at <= last_accessed_at
        OR node_limit <= 0 OR vector_bytes_per_node <= 0
        OR eligible_node_count > searchable_node_count
        OR (coverage_limited = 0 AND coverage_limit_reason IS NOT NULL)
        OR (coverage_limited = 1 AND coverage_limit_reason IS NULL)`,
  )?.count
  if (invalidScopes !== 0) {
    throw new Error('Session Host semantic transcript scope metadata is invalid.')
  }
  validateTranscriptStorageBudget(database)
  validateTranscriptModel(database, semanticModel)
}

function invalidExecutionProfileCount(database: DatabaseSync) {
  return queryCutoverRecord(
    database,
    `
      SELECT COUNT(*) AS count
      FROM session_execution_profiles
      WHERE json_valid(profile_json) <> 1
        OR json_type(profile_json, '$.modelId') <> 'text'
        OR json_extract(profile_json, '$.thinkingLevel') NOT IN (
          'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'
        )
    `,
  )?.count
}

export function validateSessionHostTarget(
  database: DatabaseSync,
  expected?: { readonly sessions: number; readonly nodes: number },
  semanticModel?: { readonly id: string; readonly revision: string; readonly dimensions: number },
  options: { readonly requireCompleteSemanticCoverage?: boolean } = {},
) {
  validateDatabaseIntegrity(database)
  const counts = targetCounts(database)
  const semanticState = queryCutoverRecord(
    database,
    `SELECT status, model_id, model_revision, dimensions, prepared_count, pending_count
      FROM session_semantic_discovery_state WHERE singleton = 1`,
  )
  validateCanonicalCoverage(counts, invalidExecutionProfileCount(database))
  validateSemanticCoverage({
    counts,
    state: semanticState,
    requireComplete: options.requireCompleteSemanticCoverage ?? true,
    ...(semanticModel ? { model: semanticModel } : {}),
  })
  if (!(options.requireCompleteSemanticCoverage ?? true)) {
    validateRecoverableSemanticCoverage(database)
  }
  validateSemanticVectors(database, semanticModel)
  validateTranscriptSemanticProjection(database, semanticModel)
  if (expected && (counts.sessions !== expected.sessions || counts.nodes !== expected.nodes)) {
    throw new Error('Session Host target row counts do not match the source database.')
  }
  return { sessions: counts.sessions, nodes: counts.nodes, bindings: counts.bindings }
}
