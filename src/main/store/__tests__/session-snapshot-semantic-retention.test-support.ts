import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import type { ProjectedSessionNodeInput } from '../../ports/session-repository'
import { runStoreEffect } from '../store-runtime'

export function transcriptNode(
  id: string,
  parentId: string | null,
  createdOrder: number,
  text: string,
  runId: string,
): ProjectedSessionNodeInput {
  return {
    id,
    parentId,
    piEntryType: 'message',
    kind: 'assistant_message',
    role: 'assistant',
    timestampMs: createdOrder,
    contentJson: JSON.stringify({ text }),
    metadataJson: JSON.stringify({ openWaggle: { runId } }),
    pathDepth: parentId === null ? 0 : createdOrder,
    createdOrder,
  }
}

export function readTermProjection(sessionId: string) {
  return runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const terms = yield* sql<{
        readonly term: string
        readonly occurrences: number
        readonly first_node_id: string
        readonly first_created_order: number
        readonly first_run_id: string | null
        readonly term_frequency: number
      }>`
        SELECT terms.term, terms.occurrences, terms.first_node_id,
          terms.first_created_order, terms.first_run_id,
          CAST(terms.occurrences AS REAL) / documents.token_count AS term_frequency
        FROM session_transcript_terms AS terms
        JOIN session_transcript_term_documents AS documents
          ON documents.session_id = terms.session_id
        WHERE terms.session_id = ${sessionId}
        ORDER BY terms.term
      `
      const documents = yield* sql<{ readonly token_count: number }>`
        SELECT token_count FROM session_transcript_term_documents
        WHERE session_id = ${sessionId}
      `
      return { terms, document: documents[0] }
    }),
  )
}
