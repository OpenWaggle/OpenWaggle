import { randomUUID } from 'node:crypto'
import { decodeUnknownOrThrow } from '@shared/schema'
import { delegationSpecificationSchema } from '@shared/schemas/session-lifecycle'
import type {
  LocalSessionCommandPayload,
  LocalSessionCommandResult,
} from '@shared/types/local-session-protocol'
import type { DelegationReadQueryOutcome } from '@shared/types/session-delegation-query'
import type { DelegationSpecificationInput } from '@shared/types/session-lifecycle'
import { SESSION_QUERY_CONTRACT_VERSION } from '@shared/types/session-query'
import { CliError } from './cli-error'
import { CommandCliUsageError } from './command-cli-option-contract'
import { option, type ParsedArguments } from './mcp-cli-arguments'
import { sessionCliResultErrorKind } from './session-cli-exit-status'
import { required, requiredSessionId } from './sessions-cli-arguments'
import {
  applyDelegationSpecificationEdits,
  type DelegationSpecificationEdits,
  delegationSpecificationEdits,
  hasDelegationSpecificationEdits,
  type SessionsCliStructuredInput,
} from './sessions-cli-delegation-input'
import {
  type InteractionAnswer,
  interactionResponseFor,
  readInteractionAnswer,
} from './sessions-cli-interaction-response'

const RUN_POSITIONAL = 1
const INTERACTION_POSITIONAL = 2
const DELEGATION_POSITIONAL = 1

/**
 * What a command line says before the CLI reads the Session Host state it builds on:
 * `request-respond` needs the pending request's kind, and an amendment the current specification.
 */
export type PreparedHiveHostInput =
  | { readonly kind: 'interaction-answer'; readonly answer: InteractionAnswer }
  | { readonly kind: 'specification-edits'; readonly edits: DelegationSpecificationEdits }

export type HiveHostInputResolution =
  | { readonly status: 'resolved'; readonly structured: SessionsCliStructuredInput }
  | { readonly status: 'refused'; readonly result: LocalSessionCommandResult }

type ExecuteHostCommand = (
  payload: LocalSessionCommandPayload,
) => Promise<LocalSessionCommandResult>

const SPECIFICATION_OPTION_LIST =
  '--objective, --deliverable, --accept, --resource, --depends-on, --handoff or a --no-* option'

/** Reads the options these commands need, without the Session Host, so mistakes stay usage errors. */
export async function prepareHiveHostInput(
  command: string,
  arguments_: ParsedArguments,
  read: {
    readonly stdin: () => Promise<string>
    readonly file: (filePath: string) => Promise<string>
  },
): Promise<PreparedHiveHostInput | undefined> {
  if (command === 'request-respond') {
    return { kind: 'interaction-answer', answer: await readInteractionAnswer(arguments_, read) }
  }
  if (command !== 'delegation-amend' && command !== 'delegation-propose-amendment') {
    return undefined
  }
  const edits = delegationSpecificationEdits(arguments_)
  const appliesProposal = command === 'delegation-amend' && option(arguments_, 'proposal')
  if (!hasDelegationSpecificationEdits(edits) && !appliesProposal) {
    throw new CommandCliUsageError(`Change at least one field with ${SPECIFICATION_OPTION_LIST}.`)
  }
  return { kind: 'specification-edits', edits }
}

function requestsListPayload(sessionId: string): LocalSessionCommandPayload {
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: { operation: 'requests-list', sessionId },
    },
  }
}

function delegationReadPayload(delegationId: string, cursor?: string): LocalSessionCommandPayload {
  return {
    contract: 'session-query-v2',
    request: {
      contractVersion: SESSION_QUERY_CONTRACT_VERSION,
      requestId: randomUUID(),
      query: { operation: 'delegations-read', delegationId, ...(cursor ? { cursor } : {}) },
    },
  }
}

async function resolveInteractionResponse(
  answer: InteractionAnswer,
  arguments_: ParsedArguments,
  execute: ExecuteHostCommand,
): Promise<HiveHostInputResolution> {
  const sessionId = requiredSessionId(arguments_.positionals[0])
  const runId = required(arguments_.positionals[RUN_POSITIONAL], 'Run ID')
  const interactionId = required(arguments_.positionals[INTERACTION_POSITIONAL], 'Interaction ID')
  const result = await execute(requestsListPayload(sessionId))
  if (sessionCliResultErrorKind(result)) return { status: 'refused', result }
  const outcome = result.contract === 'session-query-v2' ? result.response.outcome : undefined
  if (!outcome || !('requests' in outcome)) {
    throw new Error('The Session Host answered requests-list with another result.')
  }
  const interaction = outcome.requests.find(
    (request) => request.runId === runId && request.interactionId === interactionId,
  )
  if (!interaction) {
    throw new CliError(
      'not_found',
      `Run ${runId} of Session ${sessionId} has no pending request ${interactionId}.`,
    )
  }
  return {
    status: 'resolved',
    structured: { interactionResponse: interactionResponseFor(interaction, answer) },
  }
}

function delegationReadOutcome(result: LocalSessionCommandResult) {
  const outcome = result.contract === 'session-query-v2' ? result.response.outcome : undefined
  if (!outcome || !('specifications' in outcome) || !('amendmentProposals' in outcome)) {
    throw new Error('The Session Host answered delegations-read with another result.')
  }
  return outcome
}

function storedSpecification(value: unknown): DelegationSpecificationInput {
  return decodeUnknownOrThrow(delegationSpecificationSchema, value)
}

/**
 * The specification an amendment's options change: the proposal's with `--proposal`, so the
 * option alone applies the proposed change, or else the current one. It reads the Delegation's
 * history page by page until it has found it.
 */
async function baseSpecification(
  delegationId: string,
  proposalId: string | undefined,
  execute: ExecuteHostCommand,
): Promise<{ readonly specification: unknown } | { readonly refused: LocalSessionCommandResult }> {
  let cursor: string | undefined
  let current: number | undefined
  let currentSpecification: unknown
  while (true) {
    const result = await execute(delegationReadPayload(delegationId, cursor))
    if (sessionCliResultErrorKind(result)) return { refused: result }
    const page: DelegationReadQueryOutcome = delegationReadOutcome(result)
    current ??= page.delegation.currentSpecificationRevision
    const proposal = proposalId
      ? page.amendmentProposals.find((candidate) => candidate.proposalId === proposalId)
      : undefined
    if (proposal) return { specification: proposal.specification }
    currentSpecification ??= page.specifications.find(
      (specification) => specification.revision === current,
    )?.specification
    const done = currentSpecification !== undefined && proposalId === undefined
    if (done || !page.nextCursor || page.nextCursor === cursor) break
    cursor = page.nextCursor
  }
  if (currentSpecification === undefined) {
    throw new Error(`The history of Delegation ${delegationId} has no current specification.`)
  }
  // A proposal that is not in the history: the Session Host refuses the amendment with its code.
  return { specification: currentSpecification }
}

async function resolveSpecification(
  edits: DelegationSpecificationEdits,
  arguments_: ParsedArguments,
  execute: ExecuteHostCommand,
): Promise<HiveHostInputResolution> {
  const delegationId = required(arguments_.positionals[DELEGATION_POSITIONAL], 'Delegation ID')
  const base = await baseSpecification(delegationId, option(arguments_, 'proposal'), execute)
  if ('refused' in base) return { status: 'refused', result: base.refused }
  return {
    status: 'resolved',
    structured: {
      specification: applyDelegationSpecificationEdits(
        storedSpecification(base.specification),
        edits,
      ),
    },
  }
}

/** Reads the Session Host state a prepared command builds on and builds its structured input. */
export function resolveHiveHostInput(
  prepared: PreparedHiveHostInput,
  arguments_: ParsedArguments,
  execute: ExecuteHostCommand,
): Promise<HiveHostInputResolution> {
  return prepared.kind === 'interaction-answer'
    ? resolveInteractionResponse(prepared.answer, arguments_, execute)
    : resolveSpecification(prepared.edits, arguments_, execute)
}
