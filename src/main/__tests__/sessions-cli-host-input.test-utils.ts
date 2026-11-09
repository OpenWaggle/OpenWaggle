import type { AgentLoopInteraction } from '@shared/types/agent-loop-interaction'
import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'
import { fromPartial } from '@total-typescript/shoehorn'
import { vi } from 'vitest'

/** Fixtures for the Hive commands that read the Session Host before they send their request. */
export const SESSION = 'session-1'
export const RUN = 'run-1'

export function interaction(value: object): AgentLoopInteraction {
  return fromPartial<AgentLoopInteraction>({
    sessionId: SESSION,
    runId: RUN,
    interactionId: 'interaction-1',
    source: 'pi-ui',
    createdAt: 1,
    ...value,
  })
}

export const SPECIFICATION = {
  objective: 'Ship the CLI flags.',
  deliverables: ['Code'],
  acceptanceCriteria: ['Tests pass'],
  dependencies: [{ delegationId: 'delegation-0', requiredState: 'accepted' }],
  handoffContext: 'Read the ADR first.',
  resourceReferences: ['docs/adr/0053.md'],
}

export const PROPOSED = { ...SPECIFICATION, objective: 'Ship the flags and the docs.' }

export function requestsList(requests: readonly AgentLoopInteraction[]): LocalSessionCommandResult {
  return {
    contract: 'session-query-v2',
    response: {
      contractVersion: 2,
      requestId: 'request-list',
      outcome: { operation: 'requests-list', sessionId: SESSION, requests },
    },
  }
}

export function delegationPage(input: {
  readonly specifications: readonly { readonly revision: number; readonly specification: unknown }[]
  readonly proposals?: readonly { readonly proposalId: string; readonly specification: unknown }[]
  readonly nextCursor?: string
}): LocalSessionCommandResult {
  return fromPartial<LocalSessionCommandResult>({
    contract: 'session-query-v2',
    response: {
      contractVersion: 2,
      requestId: 'request-read',
      outcome: {
        operation: 'delegations-read',
        delegation: { delegationId: 'delegation-1', currentSpecificationRevision: 2 },
        specifications: input.specifications.map((entry) => ({
          ...entry,
          authoredBy: 'queen',
          createdAt: entry.revision,
        })),
        submissions: [],
        reviews: [],
        dependencies: [],
        transitions: [],
        claimRevisions: [],
        undeclaredWrites: [],
        conflicts: [],
        amendmentProposals: (input.proposals ?? []).map((proposal) => ({
          ...proposal,
          baseSpecificationRevision: 2,
          reason: 'Docs too',
          actorSessionId: 'worker',
          proposedBy: 'worker',
          status: 'pending',
          createdAt: 3,
          updatedAt: 3,
        })),
        verifications: [],
        ...(input.nextCursor ? { nextCursor: input.nextCursor } : {}),
      },
    },
  })
}

/** An accepted mutation; these tests read what was sent, not the outcome's details. */
export function accepted(): LocalSessionCommandResult {
  return fromPartial<LocalSessionCommandResult>({
    contract: 'session-control-v2',
    response: {
      contractVersion: 2,
      requestId: 'request-mutation',
      idempotencyKey: 'once',
      replayed: false,
      outcome: { operation: 'request-respond', effect: 'interaction-resolved', sessionId: SESSION },
    },
  })
}

/** The command or query each Session Host call carried, in order. */
export function sentCommands(
  calls: readonly (readonly [{ readonly payload: LocalSessionCommandPayload }])[],
) {
  return calls.map(([{ payload }]) => {
    const request = payload.request
    if ('command' in request) return request.command
    return 'query' in request ? request.query : request
  })
}

export function stderr() {
  return vi
    .mocked(process.stderr.write)
    .mock.calls.map(([chunk]) => String(chunk))
    .join('')
}

/** Catches the CLI's stdout and stderr writes, so tests can read them. */
export function captureCliOutput() {
  vi.spyOn(process.stdout, 'write').mockImplementation((_chunk, _encoding, callback) => {
    callback?.()
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
}
