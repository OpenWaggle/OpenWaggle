/**
 * The agent-loop surface inputs, each inferred from its internal schema and printed into
 * `src/generated/agent-loop.ts` by `scripts/generate-extension-sdk-types.ts`.
 */
import type * as AgentLoop from '../agent-loop-schemas.js'
import type { SchemaType } from '../schema.js'

/** A tool call, and its result once it has one, for a tool renderer. */
export type OpenWaggleToolCallSurfaceInput = SchemaType<
  typeof AgentLoop.openWaggleToolCallSurfaceInputSchema
>
/** A custom message for a custom message renderer. */
export type OpenWaggleCustomMessageSurfaceInput = SchemaType<
  typeof AgentLoop.openWaggleCustomMessageSurfaceInputSchema
>
/** An interaction request for an interaction renderer. */
export type OpenWaggleInteractionSurfaceInput = SchemaType<
  typeof AgentLoop.openWaggleInteractionSurfaceInputSchema
>
/** The transcript a transcript renderer draws. */
export type OpenWaggleTranscriptSurfaceInput = SchemaType<
  typeof AgentLoop.openWaggleTranscriptSurfaceInputSchema
>
/** The status a status widget shows. */
export type OpenWaggleStatusSurfaceInput = SchemaType<
  typeof AgentLoop.openWaggleStatusSurfaceInputSchema
>
/** What the host passes a renderer surface, by surface. */
export type OpenWaggleAgentLoopSurfaceInput = SchemaType<
  typeof AgentLoop.openWaggleAgentLoopSurfaceInputSchema
>
