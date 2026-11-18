import {
  type WaggleAgentColor as CoreWaggleAgentColor,
  type WaggleCollaborationMode as CoreWaggleCollaborationMode,
  type WaggleStopCondition as CoreWaggleStopCondition,
  WAGGLE_AGENT_COLORS,
  WAGGLE_INHERIT_MODEL,
} from '@openwaggle/waggle-core'
import type { SchemaType } from '@shared/schema'
import type {
  waggleAgentSlotDomainSchema,
  waggleConfigDomainSchema,
  waggleHandoffRequestDomainSchema,
  waggleInvocationDomainSchema,
  waggleInvocationMetadataSchema,
  waggleMetadataSchema,
  wagglePresetDomainSchema,
} from '@shared/schemas/waggle'
import type {
  waggleConsensusCheckResultSchema,
  waggleFileConflictWarningSchema,
  waggleStreamMetadataSchema,
  waggleTurnEventSchema,
} from '@shared/schemas/waggle-events'
import { SupportedModelId } from './brand'
import type { SupportedModelId as SupportedModelIdType } from './llm'

export { WAGGLE_AGENT_COLORS, WAGGLE_INHERIT_MODEL }

export type WaggleCollaborationMode = CoreWaggleCollaborationMode
export type WaggleAgentColor = CoreWaggleAgentColor
export type WaggleStopCondition = CoreWaggleStopCondition
export type WaggleModelBinding = typeof WAGGLE_INHERIT_MODEL | SupportedModelIdType

export function createWaggleModelBinding(model: string) {
  return model === WAGGLE_INHERIT_MODEL ? WAGGLE_INHERIT_MODEL : SupportedModelId(model)
}

export function isInheritedWaggleModelBinding(
  model: WaggleModelBinding,
): model is typeof WAGGLE_INHERIT_MODEL {
  return model === WAGGLE_INHERIT_MODEL
}

/*
 * Inferred from the schemas in `@shared/schemas/waggle` and `@shared/schemas/waggle-events`. The
 * wire schemas decode a slot's model as a plain string; the domain types carry it branded, as
 * `toWaggleConfig` makes it.
 */
export type WaggleAgentSlot = SchemaType<typeof waggleAgentSlotDomainSchema>
export type WaggleConfig = SchemaType<typeof waggleConfigDomainSchema>
export type WagglePreset = SchemaType<typeof wagglePresetDomainSchema>
export type WaggleInvocationMetadata = SchemaType<typeof waggleInvocationMetadataSchema>
export type WaggleInvocation = SchemaType<typeof waggleInvocationDomainSchema>
export type WaggleHandoffRequest = SchemaType<typeof waggleHandoffRequestDomainSchema>

export const WAGGLE_COLLABORATION_STATUSES = [
  'idle',
  'pending',
  'running',
  'paused',
  'completed',
  'stopped',
] as const
export type WaggleCollaborationStatus = (typeof WAGGLE_COLLABORATION_STATUSES)[number]

export type WaggleFileConflictWarning = SchemaType<typeof waggleFileConflictWarningSchema>
export type WaggleConsensusCheckResult = SchemaType<typeof waggleConsensusCheckResultSchema>
export type WaggleStreamMetadata = SchemaType<typeof waggleStreamMetadataSchema>
export type WaggleMessageMetadata = SchemaType<typeof waggleMetadataSchema>
export type WaggleTurnEvent = SchemaType<typeof waggleTurnEventSchema>
