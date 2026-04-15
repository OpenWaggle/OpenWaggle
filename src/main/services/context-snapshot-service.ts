/**
 * Context Snapshot Service — computes, caches, and pushes ContextSnapshot
 * to the renderer. Singleton module (not an Effect service) because it
 * needs BrowserWindow access for IPC emission.
 */

import type { Message } from '@shared/types/agent'
import { isCompactionEventPart } from '@shared/types/agent'
import { type ConversationId, SupportedModelId } from '@shared/types/brand'
import type {
  ContextSnapshot,
  ContextSnapshotSource,
  LastCompactionInfo,
  ModelCompatibilityInfo,
  ModelSwitchCompatibility,
  WaggleContextInfo,
} from '@shared/types/context'
import {
  computeHealthStatus,
  HEALTH_COMFORTABLE_THRESHOLD,
  HEALTH_CRITICAL_THRESHOLD,
  HEALTH_TIGHT_THRESHOLD,
} from '@shared/types/context'
import type { WaggleConfig } from '@shared/types/waggle'
import { chooseBy } from '@shared/utils/decision'
import { DEFAULT_CONTEXT_WINDOW_TOKENS } from '../domain/compaction/compaction-types'
import { estimateTokens } from '../domain/compaction/token-estimation'
import { createLogger } from '../logger'
import { providerRegistry } from '../providers'
import { broadcastToWindows } from '../utils/broadcast'

const logger = createLogger('context-snapshot')

// ─── System Overhead (Real Computation) ─────────────────────
// Computes actual token overhead from built-in tools, MCP tools,
// and the system prompt. Cached after first computation since
// tool definitions don't change during a session.

const FALLBACK_BASELINE_TOKENS = 7_500

let cachedBaselineTokens: number | null = null

/**
 * Compute the real baseline token overhead from actual tool definitions,
 * system prompt fragments, and MCP tools. No hardcoded estimates —
 * tokens are counted from the real serialized content.
 */
export function computeBaselineOverhead(): number {
  if (cachedBaselineTokens !== null) return cachedBaselineTokens

  // Lazy imports to avoid circular dependency at module load.
  // Wrapped in try-catch for test environments where these modules may not be available.
  let builtInTools: readonly { name: string; description: string; inputSchema?: unknown }[]
  let mcpTools: readonly { name: string; description: string; inputSchema?: unknown }[]
  let systemPromptModule: Record<string, { build: (ctx: unknown) => string }>

  try {
    builtInTools = require('../tools/built-in-tools').builtInTools
    systemPromptModule = require('../agent/system-prompt')
  } catch (err) {
    // Fallback for test environments — use conservative estimate.
    // Log in case this happens unexpectedly in production.
    logger.warn('Failed to load modules for baseline overhead, using fallback estimate', {
      error: err instanceof Error ? err.message : String(err),
    })
    cachedBaselineTokens = FALLBACK_BASELINE_TOKENS
    return cachedBaselineTokens
  }

  try {
    mcpTools = require('../mcp').mcpManager.getServerTools()
  } catch {
    mcpTools = []
  }

  // System prompt: compute tokens from actual fragment text.
  // Fragments that need runtime context (model name, project path) are small —
  // we build the static fragments and add a conservative overhead for dynamic ones.
  const staticFragments = [
    systemPromptModule.coreBehaviorPromptFragment,
    systemPromptModule.planToolPromptFragment,
    systemPromptModule.orchestrateToolPromptFragment,
    systemPromptModule.contextInjectionPromptFragment,
    systemPromptModule.synthesisPromptFragment,
  ]
  let systemPromptTokens = 0
  for (const fragment of staticFragments) {
    const text = fragment.build({})
    if (typeof text === 'string') {
      systemPromptTokens += estimateTokens(text)
    }
  }
  // Dynamic fragments (runtime model, project context, execution mode) add ~60-100 tokens
  const DYNAMIC_FRAGMENT_OVERHEAD = 100
  systemPromptTokens += DYNAMIC_FRAGMENT_OVERHEAD

  // Built-in tools: serialize each tool's schema and count real tokens
  let builtInToolTokens = 0
  for (const tool of builtInTools) {
    const serialized = JSON.stringify({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })
    builtInToolTokens += estimateTokens(serialized)
  }

  // MCP tools: serialize connected server tools
  let mcpToolTokens = 0
  for (const tool of mcpTools) {
    const serialized = JSON.stringify({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })
    mcpToolTokens += estimateTokens(serialized)
  }

  cachedBaselineTokens = systemPromptTokens + builtInToolTokens + mcpToolTokens

  return cachedBaselineTokens
}

/** Invalidate cached baseline (call when MCP servers connect/disconnect). */
export function invalidateBaselineCache(): void {
  cachedBaselineTokens = null
}

// ─── In-memory snapshot cache ───────────────────────────────

const snapshotCache = new Map<ConversationId, ContextSnapshot>()

// ─── Public API ─────────────────────────────────────────────

/**
 * Get the cached snapshot for a conversation, or null if not yet computed.
 */
export function getSnapshot(conversationId: ConversationId): ContextSnapshot | null {
  return snapshotCache.get(conversationId) ?? null
}

/**
 * Compute a fresh snapshot and push it to the renderer.
 */
export function computeAndPushSnapshot(
  conversationId: ConversationId,
  options: ComputeSnapshotOptions,
): ContextSnapshot {
  const snapshot = computeSnapshot(options)
  snapshotCache.set(conversationId, snapshot)
  broadcastToWindows('context:snapshot-changed', { conversationId, snapshot })
  return snapshot
}

/**
 * Called after RUN_FINISHED with API usage data (ground truth).
 */
export function onRunFinished(
  conversationId: ConversationId,
  options: Omit<ComputeSnapshotOptions, 'source' | 'usedTokensOverride'> & {
    promptTokens: number
  },
): void {
  computeAndPushSnapshot(conversationId, {
    ...options,
    source: 'run-finished',
    usedTokensOverride: options.promptTokens,
  })
}

/**
 * Called after compaction completes.
 */
export function onCompactionCompleted(
  conversationId: ConversationId,
  options: Omit<ComputeSnapshotOptions, 'source'>,
): void {
  computeAndPushSnapshot(conversationId, {
    ...options,
    source: 'compaction',
  })
}

/**
 * Called after model switch.
 */
export function onModelSwitch(
  conversationId: ConversationId,
  options: Omit<ComputeSnapshotOptions, 'source'>,
): void {
  computeAndPushSnapshot(conversationId, {
    ...options,
    source: 'model-switch',
  })
}

/**
 * Called after pin add/remove.
 */
export function onPinChange(
  conversationId: ConversationId,
  options: Omit<ComputeSnapshotOptions, 'source'>,
): void {
  computeAndPushSnapshot(conversationId, {
    ...options,
    source: 'pin-change',
  })
}

/**
 * Called when waggle state changes.
 */
export function onWaggleStateChange(
  conversationId: ConversationId,
  options: Omit<ComputeSnapshotOptions, 'source'>,
): void {
  computeAndPushSnapshot(conversationId, {
    ...options,
    source: 'waggle-change',
  })
}

const MODEL_KEY_MIN_PARTS = 3
const MODEL_KEY_MODEL_ID_START = 2

/**
 * Compute model compatibility for all enabled models.
 */
export function computeModelCompatibility(
  usedTokens: number,
  enabledModels: readonly string[],
): ModelCompatibilityInfo[] {
  const results: ModelCompatibilityInfo[] = []

  for (const modelKey of enabledModels) {
    // enabledModels format: "provider:authMethod:modelId"
    const parts = modelKey.split(':')
    const modelId =
      parts.length >= MODEL_KEY_MIN_PARTS
        ? parts.slice(MODEL_KEY_MODEL_ID_START).join(':')
        : modelKey
    const provider = providerRegistry.getProviderForModel(modelId)

    if (!provider) continue

    const contextWindow = provider.getContextWindow?.(modelId)
    const contextTokens = contextWindow?.contextTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS
    const maxOutputTokens = contextWindow?.maxOutputTokens ?? 0

    const compatibility = classifyCompatibility(usedTokens, contextTokens, maxOutputTokens)

    results.push({
      modelId: SupportedModelId(modelId),
      displayName: modelId,
      contextWindow: contextTokens,
      maxOutputTokens,
      compatibility,
    })
  }

  return results
}

/**
 * Compute a baseline-only snapshot (no conversation needed).
 * Shows the static overhead from system prompt + tools + MCP.
 * Used when no conversation is active or before the first message.
 */
export function computeBaselineSnapshot(modelId: SupportedModelId): ContextSnapshot {
  const provider = providerRegistry.getProviderForModel(String(modelId))
  const contextWindow = provider?.getContextWindow?.(String(modelId))
  const contextTokens = contextWindow?.contextTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS
  const maxOutputTokens = contextWindow?.maxOutputTokens ?? 0
  const usedTokens = computeBaselineOverhead()
  const healthStatus = computeHealthStatus(usedTokens, contextTokens, maxOutputTokens)

  return {
    usedTokens,
    contextWindow: contextTokens,
    maxOutputTokens,
    source: 'estimate',
    modelId,
    modelDisplayName: String(modelId),
    pinnedTokens: 0,
    pinnedItemCount: 0,
    pinnedMessageIds: [],
    lastCompaction: null,
    waggle: null,
    healthStatus,
  }
}

/**
 * Clear cached snapshot (e.g., when conversation is deleted).
 */
export function clearSnapshot(conversationId: ConversationId): void {
  snapshotCache.delete(conversationId)
}

// ─── Internal Computation ───────────────────────────────────

export interface ComputeSnapshotOptions {
  readonly source: ContextSnapshotSource
  readonly messages: readonly Message[]
  readonly modelId: SupportedModelId
  readonly pinnedTokens: number
  readonly pinnedItemCount: number
  readonly pinnedMessageIds: readonly string[]
  readonly waggleConfig?: WaggleConfig
  /** Override token count with API-reported value (from RUN_FINISHED). */
  readonly usedTokensOverride?: number
  /** Number of tool results stripped by Tier 1 microcompaction. */
  readonly microcompactedToolResults?: number
}

function computeSnapshot(options: ComputeSnapshotOptions): ContextSnapshot {
  const {
    source,
    messages,
    modelId,
    pinnedTokens,
    pinnedItemCount,
    waggleConfig,
    usedTokensOverride,
  } = options

  // Resolve context window from provider
  const provider = providerRegistry.getProviderForModel(String(modelId))
  const contextWindow = provider?.getContextWindow?.(String(modelId))
  const contextTokens = contextWindow?.contextTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS
  const maxOutputTokens = contextWindow?.maxOutputTokens ?? 0

  // Compute used tokens.
  // For estimates (pre-first-run), include real system overhead (prompt + tools + MCP).
  // For run-finished, the API-reported promptTokens already includes everything.
  const usedTokens =
    usedTokensOverride ?? estimateConversationTokens(messages) + computeBaselineOverhead()

  // Waggle context
  const waggle = computeWaggleContext(waggleConfig)

  // Effective budget considers waggle governing model
  const effectiveContextWindow = waggle ? waggle.effectiveBudget : contextTokens

  // Health status
  const healthStatus = computeHealthStatus(usedTokens, effectiveContextWindow, maxOutputTokens)

  // Last compaction from system messages
  const lastCompaction = findLastCompaction(messages)

  return {
    usedTokens,
    contextWindow: contextTokens,
    maxOutputTokens,
    source,
    modelId,
    modelDisplayName: String(modelId),
    pinnedTokens,
    pinnedItemCount,
    pinnedMessageIds: options.pinnedMessageIds,
    microcompactedToolResults: options.microcompactedToolResults,
    lastCompaction,
    waggle,
    healthStatus,
  }
}

function estimateConversationTokens(messages: readonly Message[]): number {
  let total = 0
  for (const message of messages) {
    for (const part of message.parts) {
      total += chooseBy(part, 'type')
        .case('text', (p) => estimateTokens(p.text))
        .case('reasoning', (p) => estimateTokens(p.text))
        .case('tool-call', (p) => estimateTokens(JSON.stringify(p.toolCall.args)))
        .case('tool-result', (p) => estimateTokens(p.toolResult.result))
        .case('attachment', (p) => estimateTokens(p.attachment.extractedText))
        .case('compaction-event', (p) => estimateTokens(p.data.description))
        .assertComplete()
    }
  }
  return total
}

function computeWaggleContext(waggleConfig?: WaggleConfig): WaggleContextInfo | null {
  if (!waggleConfig?.agents?.length) return null

  const entries = waggleConfig.agents.map((agent) => {
    const provider = providerRegistry.getProviderForModel(String(agent.model))
    const cw = provider?.getContextWindow?.(String(agent.model))
    return {
      modelId: agent.model,
      displayName: String(agent.model),
      contextWindow: cw?.contextTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS,
    }
  })

  // Find the smallest context window — this governs compaction
  const governing = entries.reduce((min, entry) =>
    entry.contextWindow < min.contextWindow ? entry : min,
  )

  return {
    activeModels: entries,
    governingModelId: governing.modelId,
    effectiveBudget: governing.contextWindow,
  }
}

function findLastCompaction(messages: readonly Message[]): LastCompactionInfo | null {
  // Search from end for the most recent system message with CompactionEventPart
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'system') continue
    for (const part of msg.parts) {
      if (isCompactionEventPart(part)) {
        return {
          timestamp: part.data.timestamp,
          type: part.data.trigger,
          messagesSummarized: part.data.metrics?.messagesSummarized ?? 0,
          tokensBefore: part.data.metrics?.tokensBefore ?? 0,
          tokensAfter: part.data.metrics?.tokensAfter ?? 0,
        }
      }
    }
  }
  return null
}

function classifyCompatibility(
  usedTokens: number,
  contextTokens: number,
  maxOutputTokens: number,
): ModelSwitchCompatibility {
  const effectiveBudget = contextTokens - maxOutputTokens
  if (effectiveBudget <= 0) return 'blocked'
  const ratio = usedTokens / effectiveBudget
  if (ratio < HEALTH_COMFORTABLE_THRESHOLD) return 'comfortable'
  if (ratio < HEALTH_TIGHT_THRESHOLD) return 'tight-fit'
  if (ratio < HEALTH_CRITICAL_THRESHOLD) return 'would-compact'
  return 'blocked'
}
