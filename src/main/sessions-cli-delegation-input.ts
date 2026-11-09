import { decodeUnknownExactOrThrow } from '@shared/schema'
import { delegationScopeClaimSchema } from '@shared/schemas/session-collaboration-control'
import { delegationSpecificationSchema } from '@shared/schemas/session-lifecycle'
import type {
  DelegationClaimTarget,
  DelegationEvidenceInput,
  DelegationEvidenceKind,
  DelegationScopeClaimInput,
} from '@shared/types/session-collaboration'
import type { DelegationSpecificationInput } from '@shared/types/session-lifecycle'
import { CommandCliUsageError } from './command-cli-option-contract'
import { hasFlag, type ParsedArguments } from './mcp-cli-arguments'

/**
 * Values a Hive command takes as structured input instead of options: the `openwaggle_hive` MCP
 * tool passes its parameters this way, and the CLI after it read what its options build on.
 */
export interface SessionsCliStructuredInput {
  readonly interactionResponse?: unknown
  readonly evidence?: readonly unknown[]
  readonly claims?: readonly unknown[]
  readonly specification?: unknown
}

/** `--evidence-<kind> <value>`; an artifact or source names what it points at in its summary. */
const EVIDENCE_OPTIONS: readonly (readonly [string, DelegationEvidenceKind])[] = [
  ['evidence-command', 'observed-command'],
  ['evidence-diff', 'workspace-diff'],
  ['evidence-note', 'asserted-note'],
  ['evidence-artifact', 'artifact'],
  ['evidence-source', 'source-reference'],
]

function evidenceItem(value: unknown): DelegationEvidenceInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Delegation evidence must be an object.')
  }
  const record = Object.fromEntries(Object.entries(value))
  const kind = EVIDENCE_OPTIONS.map(([, candidate]) => candidate).find(
    (candidate) => candidate === record.kind,
  )
  if (!kind || typeof record.summary !== 'string') {
    throw new Error('Delegation evidence requires a supported kind and string summary.')
  }
  return {
    kind,
    summary: record.summary,
    ...(typeof record.reference === 'string' ? { reference: record.reference } : {}),
  }
}

export function delegationEvidence(
  arguments_: ParsedArguments,
  structured?: readonly unknown[],
): readonly DelegationEvidenceInput[] {
  if (structured) return structured.map(evidenceItem)
  return EVIDENCE_OPTIONS.flatMap(([name, kind]) =>
    (arguments_.options.get(name) ?? []).map((value) =>
      kind === 'artifact' || kind === 'source-reference'
        ? { kind, summary: value, reference: value }
        : { kind, summary: value },
    ),
  )
}

const CLAIM_SCOPES = ['project', 'repository'] as const

function namedResource(value: string, name: string): DelegationClaimTarget {
  const separator = value.indexOf(':')
  const scope = CLAIM_SCOPES.find((candidate) => candidate === value.slice(0, separator))
  const reference = value.slice(separator + 1)
  const slash = reference.indexOf('/')
  if (separator < 0 || !scope || slash <= 0 || slash === reference.length - 1) {
    throw new CommandCliUsageError(
      `--${name} takes <project|repository>:<namespace>/<name>, not ${JSON.stringify(value)}.`,
    )
  }
  return {
    type: 'named-resource',
    scope,
    namespace: reference.slice(0, slash),
    name: reference.slice(slash + 1),
  }
}

const CLAIM_OPTIONS: readonly (readonly [
  string,
  DelegationScopeClaimInput['access'],
  (value: string, name: string) => DelegationClaimTarget,
])[] = [
  ['read', 'read', (path) => ({ type: 'workspace-file', path })],
  ['write', 'write', (path) => ({ type: 'workspace-file', path })],
  ['read-tree', 'read', (path) => ({ type: 'workspace-tree', path })],
  ['write-tree', 'write', (path) => ({ type: 'workspace-tree', path })],
  ['read-resource', 'read', namedResource],
  ['write-resource', 'write', namedResource],
]

export function delegationClaims(
  arguments_: ParsedArguments,
  structured?: readonly unknown[],
): readonly DelegationScopeClaimInput[] {
  if (structured) {
    return structured.map((claim) => decodeUnknownExactOrThrow(delegationScopeClaimSchema, claim))
  }
  return CLAIM_OPTIONS.flatMap(([name, access, target]) =>
    (arguments_.options.get(name) ?? []).map((value) => ({ access, target: target(value, name) })),
  )
}

export function delegationSpecification(structured: unknown) {
  if (structured === undefined) {
    throw new Error('Delegation amendment requires a Delegation specification.')
  }
  return decodeUnknownExactOrThrow(delegationSpecificationSchema, structured)
}

type Dependency = DelegationSpecificationInput['dependencies'][number]

/** What the specification options change; a field left out keeps the value it builds on. */
export interface DelegationSpecificationEdits {
  readonly objective?: string
  readonly deliverables?: readonly string[]
  readonly acceptanceCriteria?: readonly string[]
  readonly resourceReferences?: readonly string[]
  readonly dependencies?: readonly Dependency[]
  /** `null` removes the handoff context. */
  readonly handoffContext?: string | null
}

function dependency(value: string): Dependency {
  const separator = value.lastIndexOf(':')
  const delegationId = separator < 0 ? value : value.slice(0, separator)
  const state = separator < 0 ? 'ready_for_review' : value.slice(separator + 1)
  if (delegationId.length === 0 || (state !== 'ready_for_review' && state !== 'accepted')) {
    throw new CommandCliUsageError(
      `--depends-on takes <delegation-id>[:accepted], not ${JSON.stringify(value)}.`,
    )
  }
  return { delegationId, requiredState: state }
}

/** The values of a list option, `[]` for the flag that clears it, or none when both are absent. */
function listEdit(arguments_: ParsedArguments, set: string, clear: string) {
  const values = arguments_.options.get(set)
  const cleared = hasFlag(arguments_, clear)
  if (values && cleared) {
    throw new CommandCliUsageError(`Choose either --${set} or --${clear}, not both.`)
  }
  return cleared ? [] : values
}

function singleValue(arguments_: ParsedArguments, name: string) {
  const values = arguments_.options.get(name)
  if (values && values.length > 1) throw new CommandCliUsageError(`Pass --${name} at most once.`)
  return values?.[0]
}

/** Reads the specification options of `delegation-amend` and `delegation-propose-amendment`. */
export function delegationSpecificationEdits(
  arguments_: ParsedArguments,
): DelegationSpecificationEdits {
  const objective = singleValue(arguments_, 'objective')
  const deliverables = listEdit(arguments_, 'deliverable', 'no-deliverables')
  const acceptanceCriteria = listEdit(arguments_, 'accept', 'no-acceptance-criteria')
  const resourceReferences = listEdit(arguments_, 'resource', 'no-resources')
  const dependencies = listEdit(arguments_, 'depends-on', 'no-dependencies')
  const handoff = listEdit(arguments_, 'handoff', 'no-handoff')
  const handoffContext = handoff === undefined ? undefined : singleValue(arguments_, 'handoff')
  return {
    ...(objective === undefined ? {} : { objective }),
    ...(deliverables ? { deliverables } : {}),
    ...(acceptanceCriteria ? { acceptanceCriteria } : {}),
    ...(resourceReferences ? { resourceReferences } : {}),
    ...(dependencies ? { dependencies: dependencies.map(dependency) } : {}),
    ...(handoff === undefined ? {} : { handoffContext: handoffContext ?? null }),
  }
}

export function hasDelegationSpecificationEdits(edits: DelegationSpecificationEdits) {
  return Object.keys(edits).length > 0
}

/** The specification `base` with the edited fields replaced. */
export function applyDelegationSpecificationEdits(
  base: DelegationSpecificationInput,
  edits: DelegationSpecificationEdits,
): DelegationSpecificationInput {
  const { handoffContext: baseHandoff, ...rest } = base
  const handoffContext = edits.handoffContext === undefined ? baseHandoff : edits.handoffContext
  return {
    ...rest,
    ...(edits.objective === undefined ? {} : { objective: edits.objective }),
    ...(edits.deliverables ? { deliverables: edits.deliverables } : {}),
    ...(edits.acceptanceCriteria ? { acceptanceCriteria: edits.acceptanceCriteria } : {}),
    ...(edits.resourceReferences ? { resourceReferences: edits.resourceReferences } : {}),
    ...(edits.dependencies ? { dependencies: edits.dependencies } : {}),
    ...(handoffContext === null || handoffContext === undefined ? {} : { handoffContext }),
  }
}
