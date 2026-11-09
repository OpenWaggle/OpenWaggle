import { randomUUID } from 'node:crypto'
import { SESSION_HOST_REFUSAL_KINDS } from '@shared/domain/session-host-refusals'
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
import { positiveInteger, required, requiredSessionId } from './sessions-cli-arguments'
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
import { type ExecuteHostCommand, unlistedRequestResponse } from './sessions-cli-unlisted-request'

const RUN_POSITIONAL = 1
const INTERACTION_POSITIONAL = 2
const DELEGATION_POSITIONAL = 1
const REVISION_POSITIONAL = 2

/**
 * What a command line says before the CLI reads the Session Host state it builds on:
 * `request-respond` needs the pending request's kind, and an amendment the current specification.
 */
export type PreparedHiveHostInput =
  | { readonly kind: 'interaction-answer'; readonly answer: InteractionAnswer }
  | { readonly kind: 'specification-edits'; readonly edits: DelegationSpecificationEdits }

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
  // The Session Host applies a proposal only exactly as proposed.
  if (appliesProposal && hasDelegationSpecificationEdits(edits)) {
    throw new CommandCliUsageError(
      `--proposal applies the proposal as proposed, so it takes none of ${SPECIFICATION_OPTION_LIST}. To change it, amend without --proposal.`,
    )
  }
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

/**
 * A refused read is not the command's answer, so it is reported as an error of the refusal's
 * kind, with its code, instead of printing a query result under this command's name.
 */
function refusedRead(read: string, result: LocalSessionCommandResult) {
  const kind = sessionCliResultErrorKind(result)
  if (!kind) return undefined
  const outcome = result.contract === 'session-query-v2' ? result.response.outcome : undefined
  const error = outcome && 'error' in outcome ? outcome.error : undefined
  const detail = error ? `${error.code}: ${error.message}` : 'refused'
  return new CliError(
    kind,
    `This command reads ${read} first, and the Session Host refused it (${detail}).`,
    error ? { code: error.code } : undefined,
  )
}

async function resolveInteractionResponse(
  answer: InteractionAnswer,
  arguments_: ParsedArguments,
  execute: ExecuteHostCommand,
): Promise<SessionsCliStructuredInput> {
  const sessionId = requiredSessionId(arguments_.positionals[0])
  const runId = required(arguments_.positionals[RUN_POSITIONAL], 'Run ID')
  const interactionId = required(arguments_.positionals[INTERACTION_POSITIONAL], 'Interaction ID')
  const result = await execute(requestsListPayload(sessionId))
  const refusal = refusedRead('the pending requests', result)
  if (refusal) throw refusal
  const outcome = result.contract === 'session-query-v2' ? result.response.outcome : undefined
  if (!outcome || !('requests' in outcome)) {
    throw new Error('The Session Host answered requests-list with another result.')
  }
  const interaction = outcome.requests.find(
    (request) => request.runId === runId && request.interactionId === interactionId,
  )
  if (!interaction) {
    return unlistedRequestResponse({
      answer,
      arguments: arguments_,
      execute,
      sessionId,
      runId,
      interactionId,
    })
  }
  return { interactionResponse: interactionResponseFor(interaction, answer) }
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
 * The specification an amendment's options change: the proposal's with `--proposal`, or else the
 * one at the revision the command names. Starting from the revision named, not whatever is
 * current when the CLI reads, keeps an amendment from undoing a change made in between, and lets
 * a retry with the same `--idempotency-key` send the command it sent the first time, so the
 * Session Host replays it. The Host refuses a revision that is no longer current. It reads the
 * Delegation's history page by page until it has found it.
 */
async function baseSpecification(input: {
  readonly delegationId: string
  readonly revision: number
  readonly proposalId: string | undefined
  readonly execute: ExecuteHostCommand
}): Promise<unknown> {
  const { delegationId, revision, proposalId } = input
  let cursor: string | undefined
  let base: unknown
  while (true) {
    const result = await input.execute(delegationReadPayload(delegationId, cursor))
    const refusal = refusedRead(`Delegation ${delegationId}`, result)
    if (refusal) throw refusal
    const page: DelegationReadQueryOutcome = delegationReadOutcome(result)
    if (revision > page.delegation.currentSpecificationRevision) {
      const code = 'specification_revision_stale'
      throw new CliError(
        SESSION_HOST_REFUSAL_KINDS[code],
        `Delegation ${delegationId} is at specification revision ${String(page.delegation.currentSpecificationRevision)}, not ${String(revision)}. Read it again and pass the current revision.`,
        { code },
      )
    }
    const proposal = proposalId
      ? page.amendmentProposals.find((candidate) => candidate.proposalId === proposalId)
      : undefined
    if (proposal) return proposal.specification
    base ??= page.specifications.find((entry) => entry.revision === revision)?.specification
    const done = base !== undefined && proposalId === undefined
    if (done || !page.nextCursor || page.nextCursor === cursor) break
    cursor = page.nextCursor
  }
  if (base === undefined) {
    throw new Error(
      `The history of Delegation ${delegationId} has no specification ${String(revision)}.`,
    )
  }
  // A proposal that is not in the history: the Session Host refuses the amendment with its code.
  return base
}

async function resolveSpecification(
  edits: DelegationSpecificationEdits,
  arguments_: ParsedArguments,
  execute: ExecuteHostCommand,
): Promise<SessionsCliStructuredInput> {
  const delegationId = required(arguments_.positionals[DELEGATION_POSITIONAL], 'Delegation ID')
  const base = await baseSpecification({
    delegationId,
    revision: positiveInteger(
      arguments_.positionals[REVISION_POSITIONAL],
      'Specification revision',
    ),
    proposalId: option(arguments_, 'proposal'),
    execute,
  })
  return {
    specification: applyDelegationSpecificationEdits(storedSpecification(base), edits),
  }
}

/**
 * Reads the Session Host state a prepared command builds on and builds its structured input. A
 * refused read throws a `CliError` of the refusal's kind.
 */
export function resolveHiveHostInput(
  prepared: PreparedHiveHostInput,
  arguments_: ParsedArguments,
  execute: ExecuteHostCommand,
): Promise<SessionsCliStructuredInput> {
  return prepared.kind === 'interaction-answer'
    ? resolveInteractionResponse(prepared.answer, arguments_, execute)
    : resolveSpecification(prepared.edits, arguments_, execute)
}

/**
 * Structured input that stands in for what the Session Host read will supply, so the CLI checks
 * the rest of the command line (positionals, Session links, revisions) before it connects.
 */
export function hiveHostInputPlaceholder(command: string): SessionsCliStructuredInput | undefined {
  if (command === 'request-respond') {
    return { interactionResponse: { kind: 'notify', acknowledged: true } }
  }
  if (command !== 'delegation-amend' && command !== 'delegation-propose-amendment') return undefined
  return {
    specification: {
      objective: 'placeholder',
      deliverables: [],
      acceptanceCriteria: [],
      dependencies: [],
      resourceReferences: [],
    },
  }
}
