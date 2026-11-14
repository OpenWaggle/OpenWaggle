// Generated from src/internal/type-sources/agent-loop.ts by scripts/generate-extension-sdk-types.ts;
// do not edit. Regenerate with `bun run extension-sdk-types:generate`; the
// `extension-sdk-types` check step fails when this file no longer matches the schemas.

import type { JsonValue } from '../json.js'

/** A tool call, and its result once it has one, for a tool renderer. */
export type OpenWaggleToolCallSurfaceInput = {
  readonly surface: 'tool'
  readonly toolCall: { readonly id: string; readonly name: string; readonly input?: JsonValue }
  readonly toolResult?: {
    readonly ok: boolean
    readonly output?: JsonValue
    readonly error?: string
  }
}

/** A custom message for a custom message renderer. */
export type OpenWaggleCustomMessageSurfaceInput = {
  readonly surface: 'custom-message'
  readonly message: { readonly name: string; readonly payload?: JsonValue }
}

/** An interaction request for an interaction renderer. */
export type OpenWaggleInteractionSurfaceInput = {
  readonly surface: 'interaction'
  readonly interaction: {
    readonly id: string
    readonly customType: string
    readonly payload?: JsonValue
  }
}

/** The transcript a transcript renderer draws. */
export type OpenWaggleTranscriptSurfaceInput = {
  readonly surface: 'transcript'
  readonly transcript: {
    readonly sessionId?: string
    readonly messageCount: number
    readonly payload?: JsonValue
  }
}

/** The status a status widget shows. */
export type OpenWaggleStatusSurfaceInput = {
  readonly surface: 'status'
  readonly status: { readonly label: string; readonly payload?: JsonValue }
}

/** What the host passes a renderer surface, by surface. */
export type OpenWaggleAgentLoopSurfaceInput =
  | OpenWaggleCustomMessageSurfaceInput
  | OpenWaggleInteractionSurfaceInput
  | OpenWaggleStatusSurfaceInput
  | OpenWaggleToolCallSurfaceInput
  | OpenWaggleTranscriptSurfaceInput
