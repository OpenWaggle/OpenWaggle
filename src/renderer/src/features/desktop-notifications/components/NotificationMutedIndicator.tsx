import { BellOff } from 'lucide-react'
import { useSessionNotificationMute } from '../hooks/useNotificationMute'

const LABEL = 'Notifications muted, except when it needs you'

/** A muted Session's bell, on its sidebar row; unread still shows as usual (CONTEXT.md). */
export function NotificationMutedIndicator({ sessionId }: { readonly sessionId: string }) {
  const { muted } = useSessionNotificationMute(sessionId)
  if (!muted) return null
  return (
    <span
      role="img"
      title={LABEL}
      aria-label={LABEL}
      className="flex h-4 shrink-0 items-center text-text-tertiary"
    >
      <BellOff className="size-2.5" />
    </span>
  )
}
