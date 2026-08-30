import type { LocalSessionProfileAuthority } from '@shared/types/local-session-profile'
import type { SemanticDiscoveryReadiness } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { SESSION_DISCOVERY_WINDOW_LIMIT } from './session-discovery-window-store'
import type { DiscoverySearchRequest } from './sqlite-session-discovery-window'
import type { SqliteSessionSemanticSearch } from './sqlite-session-semantic-search'
import type {
  SqliteSessionTranscriptSemanticSearch,
  TranscriptSemanticScope,
} from './sqlite-session-transcript-semantic-search'

function restrictedSemanticReadiness(
  authority: LocalSessionProfileAuthority | undefined,
  scope: TranscriptSemanticScope | undefined,
  readiness: SemanticDiscoveryReadiness | undefined,
) {
  if (!authority || scope || !readiness) return readiness
  if (readiness.status === 'failed' || readiness.status === 'unavailable') {
    return {
      status: 'unavailable' as const,
      reason: 'Semantic discovery is unavailable for the granted scope.',
    }
  }
  return { status: readiness.status }
}

export function prepareSemanticSearch(input: {
  readonly mode: DiscoverySearchRequest['query']['mode']
  readonly authority: LocalSessionProfileAuthority | undefined
  readonly request: DiscoverySearchRequest
  readonly discovery: SqliteSessionSemanticSearch
  readonly transcript: SqliteSessionTranscriptSemanticSearch
}) {
  return Effect.gen(function* () {
    if (input.mode === 'lexical') {
      return {
        scope: undefined,
        readiness: undefined,
        publicReadiness: undefined,
        usable: false,
        fresh: false,
      }
    }
    const scope =
      input.request.query.searchScope === 'full-transcript'
        ? yield* input.transcript.prepareScope(input.authority, input.request)
        : undefined
    const selection = Effect.gen(function* () {
      const initial = scope
        ? yield* input.transcript.readiness(scope)
        : yield* input.discovery.readiness()
      const readiness = input.request.query.requireFresh
        ? scope
          ? yield* input.transcript.waitForFresh(
              scope,
              initial,
              input.request.query.waitTimeoutMs ?? 0,
            )
          : yield* input.discovery.waitForFresh(initial, input.request.query.waitTimeoutMs ?? 0)
        : initial
      const usable = scope ? input.transcript.usable(readiness) : input.discovery.usable(readiness)
      return {
        scope,
        readiness,
        publicReadiness: restrictedSemanticReadiness(input.authority, scope, readiness),
        usable: input.mode === 'hybrid' && readiness.status === 'partial' ? false : usable,
        fresh: scope ? input.transcript.fresh(readiness) : input.discovery.fresh(readiness),
      }
    })
    return yield* scope
      ? selection.pipe(
          Effect.onError(() => input.transcript.releaseScope(scope).pipe(Effect.orDie)),
        )
      : selection
  })
}

export function loadSelectedSemanticEntries(input: {
  readonly query: string
  readonly authority: LocalSessionProfileAuthority | undefined
  readonly request: DiscoverySearchRequest
  readonly discovery: SqliteSessionSemanticSearch
  readonly transcript: SqliteSessionTranscriptSemanticSearch
  readonly scope: TranscriptSemanticScope | undefined
  readonly readiness: SemanticDiscoveryReadiness | undefined
  readonly usable: boolean
}) {
  if (!input.usable || !input.readiness) return Effect.succeed([])
  return input.scope
    ? input.transcript.search(input.query, input.scope, SESSION_DISCOVERY_WINDOW_LIMIT + 1)
    : input.discovery.search(
        input.query,
        input.authority,
        input.request,
        input.readiness,
        SESSION_DISCOVERY_WINDOW_LIMIT + 1,
      )
}
