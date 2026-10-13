import type { McpJsonValue } from '@shared/types/mcp'

/**
 * What a server-to-client MCP request (elicitation, sampling) receives back from OpenWaggle UI.
 * Moved here from the removed MCP runtime port so the sampling and elicitation UI logic in
 * `mcp-client-interactions.ts` survives until Pi's MCP transport layer calls it (ADR 0051).
 */
export interface McpElicitationResult {
  readonly action: 'accept' | 'decline' | 'cancel'
  readonly content?: Readonly<Record<string, string | number | boolean | string[]>>
}

export type McpSamplingContent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: string }
  | { readonly type: 'audio'; readonly data: string; readonly mimeType: string }
  | {
      readonly type: 'tool_use'
      readonly id: string
      readonly name: string
      readonly input: Readonly<Record<string, unknown>>
    }

export interface McpSamplingResult {
  readonly model: string
  readonly role: 'assistant'
  readonly content: McpSamplingContent | McpSamplingContent[]
  readonly stopReason?: string
}

export interface McpRuntimeInteractions {
  readonly elicit: (input: {
    readonly serverInstanceId: string
    readonly serverLabel: string
    readonly request: McpJsonValue
    readonly signal?: AbortSignal
  }) => Promise<McpElicitationResult>
  readonly sample: (input: {
    readonly serverInstanceId: string
    readonly serverLabel: string
    readonly request: McpJsonValue
    readonly signal?: AbortSignal
  }) => Promise<McpSamplingResult>
}
