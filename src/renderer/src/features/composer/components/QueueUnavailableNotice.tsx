import { AlertTriangle, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'

export function followUpQueueAnnouncement(input: {
  readonly hasSession: boolean
  readonly unavailable: boolean
  readonly count: number
  readonly queueState: 'running' | 'paused'
}) {
  if (!input.hasSession) return ''
  if (input.unavailable) return 'Follow-up queue unavailable.'
  if (input.count === 0) return 'Follow-up queue empty.'
  const plural = input.count === 1 ? '' : 's'
  const state = input.queueState === 'paused' ? 'paused' : 'queued'
  return `${String(input.count)} Follow-up${plural} ${state}.`
}

export function QueueUnavailableNotice({ onRetry }: { readonly onRetry: () => Promise<void> }) {
  const [isRetrying, setIsRetrying] = useState(false)

  async function retry() {
    setIsRetrying(true)
    try {
      await onRetry()
    } finally {
      setIsRetrying(false)
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-warning/20 bg-warning/5 px-2.5 py-2">
      <AlertTriangle className="size-3.5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1" role="alert">
        <div className="text-xs font-semibold text-warning">Follow-up queue unavailable</div>
        <div className="text-xs leading-normal text-text-tertiary">
          OpenWaggle could not load durable Follow-ups. Retry before assuming the queue is empty.
        </div>
      </div>
      <Button
        variant="unstyled"
        type="button"
        onClick={() => void retry()}
        disabled={isRetrying}
        className="flex items-center gap-1 rounded-md border border-warning/30 bg-warning/8 px-2 py-1 text-warning hover:bg-warning/15"
      >
        <RotateCcw className="size-3" />
        <span className="text-xs font-semibold">{isRetrying ? 'Retrying…' : 'Retry'}</span>
      </Button>
    </div>
  )
}
