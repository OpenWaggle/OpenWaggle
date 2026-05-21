import type { ContextUsageSnapshot } from '@shared/types/context-usage'
import type { ProviderInfo, SupportedModelId } from '@shared/types/llm'
import { formatTokens } from '@/shared/lib/format-tokens'
import { CONTEXT_METER } from '../constants'

interface UsageTitleInput {
  readonly tokens: number | null
  readonly contextWindow: number | null
  readonly percent: number | null
  readonly failed: boolean
}

interface ContextMeterValueInput {
  readonly snapshot: ContextUsageSnapshot | null
  readonly fallbackContextWindow: number | null
  readonly hasActiveSession: boolean
  readonly failed: boolean
}

export function buildContextUsageRequestKey(
  sessionId: string | null,
  model: SupportedModelId,
  sessionVersion: string,
) {
  return sessionId ? `${sessionId}:${model}:${sessionVersion}` : ''
}

export function findContextWindow(
  providerModels: readonly ProviderInfo[],
  modelRef: SupportedModelId,
) {
  for (const group of providerModels) {
    const contextWindow = group.models.find((model) => model.id === modelRef)?.contextWindow
    if (contextWindow) return contextWindow
  }
  return null
}

export function buildContextMeterValue({
  snapshot,
  fallbackContextWindow,
  hasActiveSession,
  failed,
}: ContextMeterValueInput) {
  const contextWindow = snapshot?.contextWindow ?? fallbackContextWindow
  const percent = resolveUsageValue(snapshot?.percent, fallbackContextWindow, hasActiveSession)
  const tokens = resolveUsageValue(snapshot?.tokens, fallbackContextWindow, hasActiveSession)
  const normalizedPercent = clampContextPercent(percent)

  return {
    contextWindow,
    dashOffset:
      CONTEXT_METER.GEOMETRY.CIRCUMFERENCE -
      (normalizedPercent / CONTEXT_METER.THRESHOLDS.PERCENT_MAX) *
        CONTEXT_METER.GEOMETRY.CIRCUMFERENCE,
    displayValue: percent === null ? '?' : String(Math.round(normalizedPercent)),
    strokeColor: getContextStrokeColor(percent, contextWindow !== null),
    title: formatUsageTitle({ tokens, contextWindow, percent, failed }),
  }
}

function resolveUsageValue(
  snapshotValue: number | null | undefined,
  fallbackContextWindow: number | null,
  hasActiveSession: boolean,
) {
  if (snapshotValue !== undefined) return snapshotValue
  return hasActiveSession || !fallbackContextWindow ? null : 0
}

function getContextStrokeColor(percent: number | null, hasContextWindow: boolean) {
  if (!hasContextWindow || percent === null) return 'var(--color-text-muted)'
  if (percent >= CONTEXT_METER.THRESHOLDS.ERROR_PERCENT) return 'var(--color-error)'
  if (percent >= CONTEXT_METER.THRESHOLDS.WARNING_PERCENT) return 'var(--color-warning)'
  return 'var(--color-success)'
}

function clampContextPercent(percent: number | null) {
  if (percent === null) return 0
  return Math.max(0, Math.min(CONTEXT_METER.THRESHOLDS.PERCENT_MAX, percent))
}

function formatUsageTitle({ tokens, contextWindow, percent, failed }: UsageTitleInput) {
  if (failed) return 'Context usage unavailable'
  if (!contextWindow) return 'Context usage'
  if (tokens === null || percent === null) {
    return `Context: ? / ${formatTokens(contextWindow)} tokens`
  }
  return `Context: ${formatTokens(tokens)} / ${formatTokens(contextWindow)} tokens (${percent.toFixed(1)}%)`
}
