import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import {
  SESSION_QUERY_CONTRACT_VERSION,
  SESSION_QUERY_DISCOVERY_LIMIT,
} from '@shared/types/session-query'

interface ScopedWorkerReferenceInput {
  readonly execute: (payload: LocalSessionCommandPayload) => Promise<unknown>
  readonly payload: LocalSessionCommandPayload
  readonly sessionAllowed: (session: unknown) => boolean
}

interface WorkerReferenceCandidate {
  readonly sessionId: string
  readonly referenceNames: readonly string[]
}

function resultOutcome(value: unknown) {
  if (typeof value !== 'object' || value === null || !('response' in value)) return
  const response = value.response
  if (typeof response !== 'object' || response === null || !('outcome' in response)) return
  return response.outcome
}

function sessionSummaryReference(value: unknown): WorkerReferenceCandidate | undefined {
  if (typeof value !== 'object' || value === null || !('sessionId' in value)) return
  const sessionId = value.sessionId
  if (typeof sessionId !== 'string') return
  const title = 'title' in value && typeof value.title === 'string' ? value.title : undefined
  const agentDefinitionName =
    'agentDefinitionName' in value && typeof value.agentDefinitionName === 'string'
      ? value.agentDefinitionName
      : undefined
  return {
    sessionId,
    referenceNames: [sessionId, title, agentDefinitionName].filter(
      (name): name is string => name !== undefined,
    ),
  }
}

function sessionCatalogPage(value: unknown) {
  const outcome = resultOutcome(value)
  if (
    typeof outcome !== 'object' ||
    outcome === null ||
    !('operation' in outcome) ||
    outcome.operation !== 'list' ||
    !('sessions' in outcome) ||
    !Array.isArray(outcome.sessions)
  ) {
    throw new Error(
      'The Session Host returned an invalid catalog response while resolving a Worker.',
    )
  }
  const nextCursor = 'nextCursor' in outcome ? outcome.nextCursor : undefined
  if (nextCursor !== undefined && typeof nextCursor !== 'string') {
    throw new Error('The Session Host returned an invalid catalog cursor while resolving a Worker.')
  }
  return { sessions: outcome.sessions, nextCursor }
}

async function scopedWorkerCandidates(input: ScopedWorkerReferenceInput) {
  const candidates: WorkerReferenceCandidate[] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  let page = 0
  do {
    const result = await input.execute({
      contract: 'session-query-v2',
      request: {
        contractVersion: SESSION_QUERY_CONTRACT_VERSION,
        requestId: `scope:worker-reference:${input.payload.request.requestId}:${page}`,
        query: {
          operation: 'list',
          limit: SESSION_QUERY_DISCOVERY_LIMIT,
          ...(cursor ? { cursor } : {}),
        },
      },
    })
    const catalog = sessionCatalogPage(result)
    for (const session of catalog.sessions) {
      if (!input.sessionAllowed(session)) continue
      const candidate = sessionSummaryReference(session)
      if (candidate) candidates.push(candidate)
    }
    cursor = catalog.nextCursor
    if (cursor && seenCursors.has(cursor)) {
      throw new Error('The Session Host repeated a catalog cursor while resolving a Worker.')
    }
    if (cursor) seenCursors.add(cursor)
    page += 1
  } while (cursor)
  return candidates
}

function normalizedReference(value: string) {
  return value.trim().toLocaleLowerCase()
}

function uniqueWorkerReference(reference: string, candidates: readonly WorkerReferenceCandidate[]) {
  const normalized = normalizedReference(reference)
  const matches = candidates.filter((candidate) =>
    candidate.referenceNames.some((name) => normalizedReference(name) === normalized),
  )
  if (matches.length === 0) {
    throw new Error(
      `Worker reference ${JSON.stringify(reference)} was not found in the granted scope.`,
    )
  }
  if (matches.length > 1) {
    throw new Error(
      `Worker reference ${JSON.stringify(reference)} is ambiguous in the granted scope: ${matches.map((match) => match.sessionId).join(', ')}.`,
    )
  }
  return matches[0]?.sessionId
}

export async function resolveScopedMcpWorkerReference(input: ScopedWorkerReferenceInput) {
  const { payload } = input
  if (payload.contract !== 'session-control-v2') return payload
  const command = payload.request.command
  if (command.operation !== 'report' || command.target.type !== 'worker-reference') return payload
  const sessionId = uniqueWorkerReference(
    command.target.reference,
    await scopedWorkerCandidates(input),
  )
  if (!sessionId) {
    throw new Error(
      `Worker reference ${JSON.stringify(command.target.reference)} was not found in the granted scope.`,
    )
  }
  return {
    ...payload,
    request: {
      ...payload.request,
      command: { ...command, target: { type: 'session' as const, sessionId } },
    },
  }
}
