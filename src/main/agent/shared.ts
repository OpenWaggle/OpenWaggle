import { randomUUID } from 'node:crypto'
import type {
  AgentSendPayload,
  Message,
  MessagePart,
  PreparedAttachment,
} from '@shared/types/agent'
import { MessageId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'

// ---------------------------------------------------------------------------
// ChatContentPart — inline type previously duplicated in agent-loop.ts
// ---------------------------------------------------------------------------

export type ChatContentPart =
  | { type: 'text'; content: string }
  | { type: 'image'; source: { type: 'data'; value: string; mimeType: string } }
  | { type: 'document'; source: { type: 'data'; value: string; mimeType: string } }

// ---------------------------------------------------------------------------
// makeMessage — previously duplicated in agent-loop.ts and service.ts
// Uses orchestration's signature (includes optional metadata)
// ---------------------------------------------------------------------------

export function makeMessage(
  role: 'user' | 'assistant',
  parts: MessagePart[],
  model?: SupportedModelId,
  metadata?: Message['metadata'],
): Message {
  return {
    id: MessageId(randomUUID()),
    role,
    parts,
    model,
    metadata,
    createdAt: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// buildPersistedUserMessageParts — byte-for-byte identical in both files
// ---------------------------------------------------------------------------

export function buildPersistedUserMessageParts(payload: AgentSendPayload): MessagePart[] {
  const parts: MessagePart[] = []
  if (payload.text.trim()) {
    parts.push({ type: 'text', text: payload.text.trim() })
  }
  for (const attachment of payload.attachments) {
    const persisted: PreparedAttachment = {
      id: attachment.id,
      kind: attachment.kind,
      origin: attachment.origin,
      name: attachment.name,
      path: attachment.path,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      extractedText: attachment.extractedText,
    }
    parts.push({ type: 'attachment', attachment: persisted })
  }
  return parts.length > 0 ? parts : [{ type: 'text', text: '' }]
}

// ---------------------------------------------------------------------------
// Re-exports from providers layer (canonical location for provider resolution)
// ---------------------------------------------------------------------------

export type {
  ProviderResolution,
  ProviderResolutionError,
  ResolvedProviderResult,
} from '../providers/provider-resolver'
export {
  buildSamplingOptions,
  isResolutionError,
  resolveProviderAndQuality,
} from '../providers/provider-resolver'

// ---------------------------------------------------------------------------
// resolveAgentProjectPath — throw instead of process.cwd() fallback
// ---------------------------------------------------------------------------

export function resolveAgentProjectPath(
  conversationProjectPath: string | null | undefined,
): string {
  if (conversationProjectPath) return conversationProjectPath
  throw new Error('No project path set on the conversation — cannot run agent without a project')
}
