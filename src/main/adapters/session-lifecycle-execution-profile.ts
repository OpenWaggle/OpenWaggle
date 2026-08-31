import type * as SqlClient from '@effect/sql/SqlClient'
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import type { ResolvedAgentDefinitionSnapshot } from '@shared/types/agent-definition'
import {
  DEFAULT_SESSION_AGENT_CAPABILITIES,
  type SessionCapability,
} from '@shared/types/session-capability'
import type {
  ResolvedSessionExecutionProfile,
  SessionLifecycleCommand,
} from '@shared/types/session-lifecycle'
import * as Effect from 'effect/Effect'
import { resolveAgentDefinition } from '../agents/agent-definition-catalog'
import { parseResolvedAgentDefinitionSnapshot } from '../agents/agent-definition-parser'
import { SessionLifecyclePreparationError } from '../errors'
import type { PrepareSessionLifecycleInput } from '../ports/session-lifecycle-preparation-service'
import { decodeSessionExecutionProfile } from './session-run-execution-profile'

const CHILD_MANAGEMENT_CAPABILITIES = [
  'sessions:discover',
  'sessions:read',
  'sessions:spawn',
  'sessions:message',
  'sessions:steer',
  'sessions:interrupt',
  'sessions:queue',
  'sessions:report',
] as const satisfies readonly SessionCapability[]

const CHILD_DELEGATION_CAPABILITIES = [
  'delegations:read',
  'delegations:contribute',
  'delegations:review',
] as const satisfies readonly SessionCapability[]

const GRANTABLE_CHILD_CAPABILITIES = [
  ...CHILD_MANAGEMENT_CAPABILITIES,
  ...CHILD_DELEGATION_CAPABILITIES,
] as const satisfies readonly SessionCapability[]

interface ParentExecutionRow {
  readonly profile_json: string
  readonly resolved_agent_snapshot_json: string | null
  readonly authorization_ceiling: AgentAuthorizationMode
}

export interface ParentExecutionSelection {
  readonly profile: ResolvedSessionExecutionProfile
  readonly resolvedAgentSnapshot: ResolvedAgentDefinitionSnapshot | undefined
  readonly authorizationCeiling: AgentAuthorizationMode
}

export interface LifecycleExecutionContext {
  readonly parent: ParentExecutionSelection | undefined
  readonly definition: ResolvedAgentDefinitionSnapshot | undefined
}

function preparationError(operation: string, cause: unknown) {
  return new SessionLifecyclePreparationError({ operation, cause })
}

function parseParentProfile(
  row: ParentExecutionRow | undefined,
): ParentExecutionSelection | undefined {
  if (!row) return undefined
  const profile = decodeSessionExecutionProfile(row.profile_json)
  let resolvedAgentSnapshot: ResolvedAgentDefinitionSnapshot | undefined
  if (row.resolved_agent_snapshot_json) {
    const parsed: unknown = JSON.parse(row.resolved_agent_snapshot_json)
    resolvedAgentSnapshot = parseResolvedAgentDefinitionSnapshot(parsed)
  }
  return { profile, resolvedAgentSnapshot, authorizationCeiling: row.authorization_ceiling }
}

function sessionAgentSourceId(callerId: string) {
  if (!callerId.startsWith('session-agent:')) return undefined
  const remainder = callerId.slice('session-agent:'.length)
  const separator = remainder.lastIndexOf(':')
  return separator > 0 ? remainder.slice(0, separator) : undefined
}

function loadParentExecution(
  sql: SqlClient.SqlClient,
  command: SessionLifecycleCommand,
  callerId: string,
) {
  const initiatingSessionId = command.operation === 'launch' ? sessionAgentSourceId(callerId) : null
  if (command.operation !== 'spawn' && command.operation !== 'fork' && !initiatingSessionId) {
    return Effect.succeed(undefined)
  }
  const inheritedSessionId =
    command.operation === 'spawn'
      ? command.parentSessionId
      : command.operation === 'fork'
        ? command.sourceSessionId
        : initiatingSessionId
  return Effect.gen(function* () {
    const rows = yield* sql<ParentExecutionRow>`
      SELECT profile_json, resolved_agent_snapshot_json, authorization_ceiling
      FROM session_execution_profiles
      WHERE session_id = ${inheritedSessionId}
      LIMIT 1
    `
    return parseParentProfile(rows[0])
  })
}

function definitionForCommand(
  projectPath: string,
  command: SessionLifecycleCommand,
  parent: ParentExecutionSelection | undefined,
) {
  const requestedName =
    command.operation === 'fork' ? undefined : command.specialization?.agentDefinitionName
  if (!requestedName) return Effect.succeed(parent?.resolvedAgentSnapshot)
  return Effect.tryPromise({
    try: () => resolveAgentDefinition({ projectPath, name: requestedName }),
    catch: (cause) => preparationError('resolve-agent-definition', cause),
  })
}

export function resolveLifecycleExecutionContext(
  sql: SqlClient.SqlClient,
  projectPath: string,
  command: SessionLifecycleCommand,
  callerId: string,
) {
  return Effect.gen(function* () {
    const parent = yield* loadParentExecution(sql, command, callerId)
    const definition = yield* definitionForCommand(projectPath, command, parent)
    return { parent, definition } satisfies LifecycleExecutionContext
  })
}

export function resolveLifecycleSessionCapabilities(input: {
  readonly command: SessionLifecycleCommand
  readonly profile: ResolvedSessionExecutionProfile
  readonly callerCapabilities?: readonly SessionCapability[]
}) {
  if (input.command.operation === 'spawn') return input.profile.sessionCapabilities
  const configured = input.profile.sessionCapabilities ?? DEFAULT_SESSION_AGENT_CAPABILITIES
  return input.callerCapabilities
    ? configured.filter((capability) => input.callerCapabilities?.includes(capability))
    : [...configured]
}

export function reduceAuthorizationCeiling(
  requested: AgentAuthorizationMode,
  ...ceilings: readonly (AgentAuthorizationMode | undefined)[]
) {
  return ceilings.includes('ask-for-approval') ? 'ask-for-approval' : requested
}

function intersectOptional<T>(
  inherited: readonly T[] | undefined,
  selected: readonly T[] | undefined,
): readonly T[] | undefined {
  if (!inherited) return selected
  if (!selected) return inherited
  const allowed = new Set(selected)
  return inherited.filter((value) => allowed.has(value))
}

function preferred<T>(
  requested: T | undefined,
  defined: T | undefined,
  inherited: T | undefined,
  fallback: T,
): T {
  return requested ?? defined ?? inherited ?? fallback
}

function accessRestrictions(
  inherited: ResolvedSessionExecutionProfile | undefined,
  definition: ResolvedAgentDefinitionSnapshot | undefined,
) {
  const tools = intersectOptional(inherited?.tools, definition?.tools)
  const skills = intersectOptional(inherited?.skills, definition?.skills)
  const mcpServers = intersectOptional(inherited?.mcpServers, definition?.mcpServers)
  const sessionCapabilities = intersectOptional(
    inherited?.sessionCapabilities,
    definition?.sessionCapabilities,
  )
  return {
    ...(tools ? { tools } : {}),
    ...(skills ? { skills } : {}),
    ...(mcpServers ? { mcpServers } : {}),
    ...(sessionCapabilities ? { sessionCapabilities } : {}),
  }
}

export function buildLifecycleExecutionProfile(input: {
  readonly command: SessionLifecycleCommand
  readonly settings: {
    readonly selectedModel: string
    readonly thinkingLevel: ResolvedSessionExecutionProfile['thinkingLevel']
  }
  readonly parent: ParentExecutionSelection | undefined
  readonly definition: ResolvedAgentDefinitionSnapshot | undefined
}): ResolvedSessionExecutionProfile {
  const { command, settings, parent, definition } = input
  const inherited = parent?.profile
  const specialization = command.operation === 'fork' ? undefined : command.specialization
  return {
    modelId: preferred(
      specialization?.modelId,
      definition?.model,
      inherited?.modelId,
      settings.selectedModel,
    ),
    thinkingLevel: preferred(
      specialization?.thinkingLevel,
      definition?.reasoning,
      inherited?.thinkingLevel,
      settings.thinkingLevel,
    ),
    ...(definition?.name ? { agentDefinitionName: definition.name } : {}),
    ...accessRestrictions(inherited, definition),
  }
}

export function deriveChildCapabilities(
  input: PrepareSessionLifecycleInput,
  profile: ResolvedSessionExecutionProfile,
) {
  if (input.request.command.operation !== 'spawn') return undefined
  const configured = profile.sessionCapabilities ?? DEFAULT_SESSION_AGENT_CAPABILITIES
  return GRANTABLE_CHILD_CAPABILITIES.filter(
    (capability) =>
      configured.includes(capability) &&
      (!input.callerCapabilities || input.callerCapabilities.includes(capability)),
  )
}
