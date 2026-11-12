import type { SchemaType } from '@shared/schema'
import type {
  agentLoopResponseInputSchema,
  agentLoopResponseSchema,
  confirmResponseSchema,
  customResponseSchema,
  editorResponseSchema,
  inputResponseSchema,
  notifyResponseSchema,
  selectResponseSchema,
} from '@shared/schemas/agent-loop-interaction'
import type {
  agentLoopConfirmInteractionSchema,
  agentLoopConfirmPurposeSchema,
  agentLoopCustomInteractionSchema,
  agentLoopEditorInteractionSchema,
  agentLoopInputInteractionSchema,
  agentLoopInteractionBaseSchema,
  agentLoopInteractionErrorCodeSchema,
  agentLoopInteractionKindSchema,
  agentLoopInteractionSchema,
  agentLoopInteractionSourceSchema,
  agentLoopInteractionStatusSchema,
  agentLoopInteractionSubmitResultSchema,
  agentLoopNotifyInteractionSchema,
  agentLoopNotifyLevelSchema,
  agentLoopSelectInteractionSchema,
} from '@shared/schemas/agent-loop-interaction-request'

/* Inferred from the schemas in `@shared/schemas/agent-loop-interaction-request` and `-interaction`. */
export type AgentLoopInteractionKind = SchemaType<typeof agentLoopInteractionKindSchema>
export type AgentLoopInteractionStatus = SchemaType<typeof agentLoopInteractionStatusSchema>
export type AgentLoopInteractionSource = SchemaType<typeof agentLoopInteractionSourceSchema>
export type AgentLoopNotifyLevel = SchemaType<typeof agentLoopNotifyLevelSchema>
export type AgentLoopInteractionBase = SchemaType<typeof agentLoopInteractionBaseSchema>
export type AgentLoopConfirmPurpose = SchemaType<typeof agentLoopConfirmPurposeSchema>
export type AgentLoopConfirmInteraction = SchemaType<typeof agentLoopConfirmInteractionSchema>
export type AgentLoopSelectInteraction = SchemaType<typeof agentLoopSelectInteractionSchema>
export type AgentLoopInputInteraction = SchemaType<typeof agentLoopInputInteractionSchema>
export type AgentLoopEditorInteraction = SchemaType<typeof agentLoopEditorInteractionSchema>
export type AgentLoopNotifyInteraction = SchemaType<typeof agentLoopNotifyInteractionSchema>
export type AgentLoopCustomInteraction = SchemaType<typeof agentLoopCustomInteractionSchema>
export type AgentLoopInteraction = SchemaType<typeof agentLoopInteractionSchema>

export type AgentLoopConfirmResponse = SchemaType<typeof confirmResponseSchema>
export type AgentLoopSelectResponse = SchemaType<typeof selectResponseSchema>
export type AgentLoopInputResponse = SchemaType<typeof inputResponseSchema>
export type AgentLoopEditorResponse = SchemaType<typeof editorResponseSchema>
export type AgentLoopNotifyResponse = SchemaType<typeof notifyResponseSchema>
export type AgentLoopCustomResponse = SchemaType<typeof customResponseSchema>
export type AgentLoopInteractionResponse = SchemaType<typeof agentLoopResponseSchema>
export type AgentLoopInteractionResponseInput = SchemaType<typeof agentLoopResponseInputSchema>

export type AgentLoopInteractionErrorCode = SchemaType<typeof agentLoopInteractionErrorCodeSchema>
export type AgentLoopInteractionSubmitResult = SchemaType<
  typeof agentLoopInteractionSubmitResultSchema
>
