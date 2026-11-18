import type { SchemaType } from '@shared/schema'
import type {
  delegationSpecificationSchema,
  forkCommandSchema,
  forkWorkspaceSchema,
  launchWorkspaceSchema,
  sessionLifecycleCommandSchema,
  sessionLifecycleOutcomeSchema,
  sessionLifecycleRequestSchema,
  sessionLifecycleResponseSchema,
  spawnWorkspaceSchema,
  specializationSchema,
} from '@shared/schemas/session-lifecycle'
import type { SessionCapability } from './session-capability'
import type { ThinkingLevel } from './settings'

export const SESSION_LIFECYCLE_OPERATIONS = ['create', 'fork', 'launch', 'spawn'] as const
export const SESSION_LIFECYCLE_CONTRACT_VERSION = 2 as const

export type LaunchWorkspaceSelection = SchemaType<typeof launchWorkspaceSchema>

export type SpawnWorkspaceSelection = SchemaType<typeof spawnWorkspaceSchema>

export type ForkWorkspaceSelection = SchemaType<typeof forkWorkspaceSchema>

export type SessionExecutionSpecialization = SchemaType<typeof specializationSchema>

export interface ResolvedSessionExecutionProfile {
  readonly modelId: string
  readonly thinkingLevel: ThinkingLevel
  readonly agentDefinitionName?: string
  readonly tools?: readonly string[]
  readonly skills?: readonly string[]
  readonly mcpServers?: readonly string[]
  readonly sessionCapabilities?: readonly SessionCapability[]
}

export type DelegationSpecificationInput = SchemaType<typeof delegationSpecificationSchema>

export type ForkSessionCommand = SchemaType<typeof forkCommandSchema>

export type SessionLifecycleCommand = SchemaType<typeof sessionLifecycleCommandSchema>

export type SessionLifecycleRequest = SchemaType<typeof sessionLifecycleRequestSchema>

export type SessionLifecycleOutcome = SchemaType<typeof sessionLifecycleOutcomeSchema>

export type SessionLifecycleResponse = SchemaType<typeof sessionLifecycleResponseSchema>
