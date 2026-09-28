import { useChatStore } from '@/features/chat/state'
import { useProviderStore } from '@/features/providers/state'
import { formatContextWindow } from '@/shared/lib/format-tokens'
import { useComposerModel } from '../hooks/useComposerModel'
import { useContextUsageSnapshot } from '../hooks/useContextUsageSnapshot'
import {
  buildContextMeterValue,
  buildContextUsageRequestKey,
  findContextWindow,
} from '../lib/context-meter-view'
import { ContextMeterRing } from './ContextMeterRing'

export function ContextMeter() {
  const activeSessionId = useChatStore((s) => s.activeSessionId)
  const activeSession = useChatStore((s) => s.activeSession)
  const composerModel = useComposerModel()
  // A streaming turn keeps reporting usage for the model it started with; the meter follows that
  // model until the turn ends so a mid-turn switch never mixes one model's usage with another's window.
  const selectedModel = composerModel.runningModel ?? composerModel.model
  const providerModels = useProviderStore((s) => s.providerModels)
  const fallbackContextWindow = findContextWindow(providerModels, selectedModel)
  const requestKey = buildContextUsageRequestKey(
    activeSessionId ? String(activeSessionId) : null,
    selectedModel,
    activeSession
      ? `${String(activeSession.updatedAt)}:${String(activeSession.messages.length)}`
      : '',
  )
  const usage = useContextUsageSnapshot({
    activeSessionId,
    selectedModel,
    requestKey,
  })
  const meter = buildContextMeterValue({
    snapshot: usage.snapshot,
    fallbackContextWindow,
    hasActiveSession: Boolean(activeSessionId),
    failed: usage.failed,
  })

  return (
    <div className="flex items-center gap-1.5 @max-xl/composer-toolbar:hidden" title={meter.title}>
      <ContextMeterRing
        displayValue={meter.displayValue}
        strokeColor={meter.strokeColor}
        dashOffset={meter.dashOffset}
        failed={usage.failed}
      />
      {meter.contextWindow ? (
        <span className="hidden font-mono text-xs text-text-tertiary sm:inline">
          / {formatContextWindow(meter.contextWindow)}
        </span>
      ) : null}
    </div>
  )
}
