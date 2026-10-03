import { match } from '@diegogbrisa/ts-match'
import type { UIMessageMetadata } from '@shared/types/chat-ui'
import { Clock3 } from 'lucide-react'

/** Under a steer the agent has not read yet: why it is still waiting. */
export function SteerDeliveryStatus({
  delivery,
}: {
  readonly delivery: NonNullable<UIMessageMetadata['steerDelivery']>
}) {
  const label = match(delivery)
    .with('waiting-for-compaction', () => 'Will send after compaction')
    .with('sending', () => 'Queued')
    .exhaustive()
  return (
    <div className="mt-1.5 flex items-center gap-1 text-xs text-text-tertiary">
      <Clock3 className="size-3" />
      <span>{label}</span>
    </div>
  )
}
