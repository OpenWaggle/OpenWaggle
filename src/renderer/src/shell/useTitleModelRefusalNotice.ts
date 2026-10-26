import { useNavigate } from '@tanstack/react-router'
import { useEffect, useEffectEvent } from 'react'
import { api } from '@/shared/lib/ipc'
import { useUIStore } from '@/shell/ui-store'

const REASON_MAX_LENGTH = 160

const SENTENCE_END = /[.!?…]$/

function shortReason(reason: string) {
  const firstLine = reason.split('\n')[0]?.trim() ?? ''
  const short =
    firstLine.length > REASON_MAX_LENGTH
      ? `${firstLine.slice(0, REASON_MAX_LENGTH - 1)}…`
      : firstLine
  return SENTENCE_END.test(short) ? short : `${short}.`
}

export const TitleModelRefusalCopy = {
  message: (model: string, reason: string) =>
    `The Title model ${model} was refused: ${shortReason(reason)} Sessions are titled with their own model for now.`,
  action: 'Title model settings',
} as const

/**
 * Says once when the provider refused the Title model (#357). The Session Host sends the refusal
 * once per model; background titles meanwhile use each Session's own model.
 */
export function useTitleModelRefusalNotice() {
  const navigate = useNavigate()
  const announce = useEffectEvent((model: string, reason: string) => {
    useUIStore.getState().showActionToast({
      message: TitleModelRefusalCopy.message(model, reason),
      variant: 'error',
      action: {
        label: TitleModelRefusalCopy.action,
        onClick: () => void navigate({ to: '/settings/$tab', params: { tab: 'connections' } }),
      },
    })
  })
  useEffect(() => {
    const announced = new Set<string>()
    return api.onSessionHostEvent((event) => {
      if (event.payload.kind !== 'session-title-model-refused') return
      const key = `${event.payload.model}:${String(event.payload.retryAt)}`
      if (announced.has(key)) return
      announced.add(key)
      announce(event.payload.model, event.payload.reason)
    })
  }, [])
}
