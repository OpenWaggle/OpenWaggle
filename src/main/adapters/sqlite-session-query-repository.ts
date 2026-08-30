import * as SqlClient from '@effect/sql/SqlClient'
import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { SessionQueryRequest } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SessionQueryRepositoryError } from '../errors'
import { SessionQueryRepository } from '../ports/session-query-repository'
import {
  defaultSessionEmbeddingModel,
  type SessionEmbeddingModel,
} from './multilingual-e5-session-embedding-model'
import { SessionDiscoveryWindowStore } from './session-discovery-window-store'
import { listDelegationConflicts } from './sqlite-delegation-conflict-query'
import { listDelegations, readDelegation } from './sqlite-delegation-query'
import { searchSessions } from './sqlite-session-discovery'
import {
  listSessionExportOperations,
  readSessionExportOperation,
} from './sqlite-session-export-operation-query'
import { readSessionExport } from './sqlite-session-export-query'
import { listSessions } from './sqlite-session-query-catalog'
import { readItems, readQueue, readSession, readStatus } from './sqlite-session-query-details'
import { readTurns } from './sqlite-session-query-turns'
import { SqliteSessionSemanticSearch } from './sqlite-session-semantic-search'
import { SqliteSessionTranscriptSemanticSearch } from './sqlite-session-transcript-semantic-search'

function repositoryError(operation: string, cause: unknown) {
  return new SessionQueryRepositoryError({ operation, cause })
}

function queryProgram(
  sql: SqlClient.SqlClient,
  authority: LocalSessionProfileAuthority | undefined,
  request: SessionQueryRequest,
  windows: SessionDiscoveryWindowStore,
  semantic: SqliteSessionSemanticSearch,
  transcriptSemantic: SqliteSessionTranscriptSemanticSearch,
  callerId?: string,
) {
  if (request.query.operation === 'list') {
    return listSessions(sql, authority, { ...request, query: request.query })
  }
  if (request.query.operation === 'search') {
    return searchSessions(
      sql,
      authority,
      { ...request, query: request.query },
      windows,
      semantic,
      transcriptSemantic,
      callerId,
    )
  }
  if (request.query.operation === 'read') return readSession(sql, request)
  if (request.query.operation === 'turns') {
    return readTurns(sql, { ...request, query: request.query })
  }
  if (request.query.operation === 'delegations-list') {
    return listDelegations(sql, authority, { ...request, query: request.query })
  }
  if (request.query.operation === 'delegations-read') return readDelegation(sql, authority, request)
  if (request.query.operation === 'delegations-conflicts') {
    return listDelegationConflicts(sql, authority, { ...request, query: request.query })
  }
  if (request.query.operation === 'items') return readItems(sql, request)
  if (request.query.operation === 'export') {
    return readSessionExport(sql, { ...request, query: request.query })
  }
  if (request.query.operation === 'exports-list') {
    return listSessionExportOperations(sql, { ...request, query: request.query })
  }
  if (request.query.operation === 'exports-read') {
    return readSessionExportOperation(sql, { ...request, query: request.query })
  }
  if (request.query.operation === 'status') return readStatus(sql, request)
  if (request.query.operation === 'wait' || request.query.operation === 'exports-wait') {
    throw new Error('Session wait must be executed by SessionWaitService.')
  }
  return readQueue(sql, request)
}

function execute(
  sql: SqlClient.SqlClient,
  authority: LocalSessionProfileAuthority | undefined,
  request: SessionQueryRequest,
  windows: SessionDiscoveryWindowStore,
  semantic: SqliteSessionSemanticSearch,
  transcriptSemantic: SqliteSessionTranscriptSemanticSearch,
  callerId?: string,
) {
  return queryProgram(
    sql,
    authority,
    request,
    windows,
    semantic,
    transcriptSemantic,
    callerId,
  ).pipe(Effect.mapError((cause) => repositoryError(`query-${request.query.operation}`, cause)))
}

export function makeSqliteSessionQueryRepositoryLive(
  model: SessionEmbeddingModel = defaultSessionEmbeddingModel,
) {
  return Layer.effect(
    SessionQueryRepository,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const windows = new SessionDiscoveryWindowStore()
      const semantic = new SqliteSessionSemanticSearch(sql, model)
      const transcriptSemantic = new SqliteSessionTranscriptSemanticSearch(sql, model)
      return SessionQueryRepository.of({
        execute: ({ callerId, authority, request }) =>
          execute(sql, authority, request, windows, semantic, transcriptSemantic, callerId),
      })
    }),
  )
}

export const SqliteSessionQueryRepositoryLive = makeSqliteSessionQueryRepositoryLive()
