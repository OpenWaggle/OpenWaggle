import { randomUUID } from 'node:crypto'
import type {
  AgentSendPayload,
  Message,
  MessagePart,
  PreparedAttachment,
} from '@shared/types/agent'
import { isSubscriptionProvider } from '@shared/types/auth'
import { MessageId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { Provider, ProviderConfig, QualityPreset } from '@shared/types/settings'
import { getActiveApiKey } from '../auth'
import type { ProjectQualityOverrides } from '../config/project-config'
import { providerRegistry } from '../providers'
import type { ProviderDefinition } from '../providers/provider-definition'
import { type ResolvedQualityConfig, resolveQualityConfig } from './quality-config'

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
// buildSamplingOptions — extract the topP conditional
// ---------------------------------------------------------------------------

export function buildSamplingOptions(qualityConfig: { temperature?: number; topP?: number }): {
  temperature?: number
  topP?: number
} {
  const opts: { temperature?: number; topP?: number } = {}
  if (qualityConfig.temperature !== undefined) opts.temperature = qualityConfig.temperature
  if (qualityConfig.topP !== undefined) opts.topP = qualityConfig.topP
  return opts
}

// ---------------------------------------------------------------------------
// resolveAgentProjectPath — throw instead of process.cwd() fallback
// ---------------------------------------------------------------------------

export function resolveAgentProjectPath(
  conversationProjectPath: string | null | undefined,
): string {
  if (conversationProjectPath) return conversationProjectPath
  throw new Error('No project path set on the conversation — cannot run agent without a project')
}

// ---------------------------------------------------------------------------
// resolveProviderAndQuality — centralized provider resolution + validation
// ---------------------------------------------------------------------------

export interface ResolvedProviderResult {
  readonly ok: true
  readonly provider: ProviderDefinition
  readonly providerConfig: ProviderConfig
  readonly resolvedModel: SupportedModelId
  readonly qualityConfig: ResolvedQualityConfig
}

export interface ProviderResolutionError {
  readonly ok: false
  readonly reason: string
}

export type ProviderResolution = ResolvedProviderResult | ProviderResolutionError

export function isResolutionError(result: ProviderResolution): result is ProviderResolutionError {
  return !result.ok
}

export async function resolveProviderAndQuality(
  model: SupportedModelId,
  qualityPreset: QualityPreset,
  providers: Readonly<Partial<Record<Provider, ProviderConfig>>>,
  projectOverrides?: ProjectQualityOverrides,
): Promise<ProviderResolution> {
  const provider = providerRegistry.getProviderForModel(model)
  if (!provider) {
    return { ok: false, reason: `No provider registered for model: ${model}` }
  }

  const providerConfig = providers[provider.id]
  if (!providerConfig?.enabled) {
    return { ok: false, reason: `${provider.displayName} is disabled in settings` }
  }

  // For subscription auth, refresh the token before proceeding
  let effectiveConfig = providerConfig
  if (providerConfig.authMethod === 'subscription' && isSubscriptionProvider(provider.id)) {
    const freshToken = await getActiveApiKey(provider.id)
    if (!freshToken) {
      return {
        ok: false,
        reason: `Session expired for ${provider.displayName}. Please sign in again.`,
      }
    }
    effectiveConfig = { ...providerConfig, apiKey: freshToken }
  }

  if (provider.requiresApiKey && !effectiveConfig.apiKey) {
    return { ok: false, reason: `No API key configured for ${provider.displayName}` }
  }

  const qualityConfig = resolveQualityConfig(provider, model, qualityPreset, projectOverrides)

  return {
    ok: true,
    provider,
    providerConfig: effectiveConfig,
    resolvedModel: model,
    qualityConfig,
  }
}
