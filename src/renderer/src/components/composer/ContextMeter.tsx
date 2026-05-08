import type { ContextUsageSnapshot } from '@shared/types/context-usage'
import type { ProviderInfo, SupportedModelId } from '@shared/types/llm'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { formatContextWindow, formatTokens } from '@/lib/format-tokens'
import { api } from '@/lib/ipc'
import { createRendererLogger } from '@/lib/logger'
import { useChatStore } from '@/stores/chat-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { useProviderStore } from '@/stores/provider-store'

const logger = createRendererLogger('context-meter')

const PERCENT_MAX = 100
const WARNING_PERCENT = 70
const ERROR_PERCENT = 90
const METER_SIZE = 28
const STROKE_WIDTH = 2
const HALF_DIVISOR = 2
const RADIUS = (METER_SIZE - STROKE_WIDTH) / HALF_DIVISOR
const CIRCUMFERENCE = HALF_DIVISOR * Math.PI * RADIUS
const CENTER = METER_SIZE / HALF_DIVISOR
const VIEWBOX_SIZE = METER_SIZE

interface ContextUsageRequestState {
  readonly key: string
  readonly snapshot: ContextUsageSnapshot | null
  readonly failed: boolean
}

function buildRequestKey(
  sessionId: string | null,
  model: SupportedModelId,
  sessionVersion: string,
): string {
  return sessionId ? `${sessionId}:${model}:${sessionVersion}` : ''
}

function findContextWindow(
  providerModels: readonly ProviderInfo[],
  modelRef: SupportedModelId,
): number | null {
  for (const group of providerModels) {
    for (const model of group.models) {
      if (model.id === modelRef && model.contextWindow) {
        return model.contextWindow
      }
    }
  }
  return null
}

function getStrokeColor(percent: number | null, hasContextWindow: boolean): string {
  if (!hasContextWindow || percent === null) {
    return 'var(--color-text-muted)'
  }
  if (percent >= ERROR_PERCENT) {
    return 'var(--color-error)'
  }
  if (percent >= WARNING_PERCENT) {
    return 'var(--color-warning)'
  }
  return 'var(--color-success)'
}

function clampPercent(percent: number | null): number {
  if (percent === null) {
    return 0
  }
  return Math.max(0, Math.min(PERCENT_MAX, percent))
}

function formatUsageTitle(input: {
  readonly tokens: number | null
  readonly contextWindow: number | null
  readonly percent: number | null
  readonly failed: boolean
}): string {
  if (input.failed) {
    return 'Context usage unavailable'
  }
  if (!input.contextWindow) {
    return 'Context usage'
  }
  if (input.tokens === null || input.percent === null) {
    return `Context: ? / ${formatTokens(input.contextWindow)} tokens`
  }
  return `Context: ${formatTokens(input.tokens)} / ${formatTokens(input.contextWindow)} tokens (${input.percent.toFixed(1)}%)`
}

export function ContextMeter() {
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const activeSession = useChatStore((s) => s.activeSession)
  const selectedModel = usePreferencesStore((s) => s.settings.selectedModel)
  const providerModels = useProviderStore((s) => s.providerModels)
  const fallbackContextWindow = findContextWindow(providerModels, selectedModel)
  const sessionVersion = activeSession
    ? `${String(activeSession.updatedAt)}:${String(activeSession.messages.length)}`
    : ''
  const requestKey = buildRequestKey(
    activeSessionId ? String(activeSessionId) : null,
    selectedModel,
    sessionVersion,
  )

  const [requestState, setRequestState] = useState<ContextUsageRequestState>({
    key: '',
    snapshot: null,
    failed: false,
  })

  useEffect(() => {
    if (!activeSessionId) {
      return
    }
    if (typeof api.getContextUsage !== 'function') {
      return
    }

    let cancelled = false
    const currentRequestKey = requestKey

    api
      .getContextUsage(activeSessionId, selectedModel)
      .then((snapshot) => {
        if (cancelled) {
          return
        }
        setRequestState({ key: currentRequestKey, snapshot, failed: false })
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return
        }
        logger.warn('Failed to load Pi context usage', {
          error: error instanceof Error ? error.message : String(error),
        })
        setRequestState({ key: currentRequestKey, snapshot: null, failed: true })
      })

    return () => {
      cancelled = true
    }
  }, [activeSessionId, selectedModel, requestKey])

  const snapshot = requestState.key === requestKey ? requestState.snapshot : null
  const contextWindow = snapshot?.contextWindow ?? fallbackContextWindow
  const percent = snapshot?.percent ?? (activeSessionId || !fallbackContextWindow ? null : 0)
  const tokens = snapshot?.tokens ?? (activeSessionId || !fallbackContextWindow ? null : 0)
  const normalizedPercent = clampPercent(percent)
  const dashOffset = CIRCUMFERENCE - (normalizedPercent / PERCENT_MAX) * CIRCUMFERENCE
  const strokeColor = getStrokeColor(percent, contextWindow !== null)
  const displayValue = percent === null ? '?' : String(Math.round(normalizedPercent))
  const title = formatUsageTitle({
    tokens,
    contextWindow,
    percent,
    failed: requestState.key === requestKey && requestState.failed,
  })

  return (
    <div className="flex items-center gap-1.5" title={title}>
      <div
        className={cn(
          'relative flex shrink-0 items-center justify-center rounded-full',
          'text-text-tertiary',
        )}
        style={{ width: METER_SIZE, height: METER_SIZE }}
      >
        <svg
          width={METER_SIZE}
          height={METER_SIZE}
          viewBox={`0 0 ${String(VIEWBOX_SIZE)} ${String(VIEWBOX_SIZE)}`}
          className="-rotate-90"
          role="img"
          aria-label={
            requestState.key === requestKey && requestState.failed
              ? 'Context usage unavailable'
              : 'Context usage meter'
          }
        >
          <title>Context usage meter</title>
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke="color-mix(in oklab, var(--color-text-muted) 18%, transparent)"
            strokeWidth={STROKE_WIDTH}
          />
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={strokeColor}
            strokeWidth={STROKE_WIDTH}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
          />
        </svg>
        <span
          className="absolute font-mono text-[8.5px] font-semibold leading-none tabular-nums"
          style={{ color: strokeColor }}
        >
          {displayValue}
        </span>
      </div>
      {contextWindow ? (
        <span className="hidden font-mono text-[11px] text-text-tertiary sm:inline">
          / {formatContextWindow(contextWindow)}
        </span>
      ) : null}
    </div>
  )
}
