import type { SessionId } from '@shared/types/brand'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'
import { useSessionResources } from '../hooks/useSessionResources'
import { isViewableSessionImage } from '../model/session-resource-viewability'
import { SessionResourcePreview } from './SessionResourcePreview'

function SessionMessageImagesForSession({
  sessionId,
  messageId,
}: {
  readonly sessionId: SessionId
  readonly messageId: string
}) {
  const resources = useSessionResources(String(sessionId))
  const openViewer = useUIStore((state) => state.openResourceViewer)
  const images = (resources.data ?? []).filter(
    (resource) =>
      isViewableSessionImage(resource) &&
      resource.occurrences.some((occurrence) => occurrence.nodeId === messageId),
  )

  if (images.length === 0) return null

  return (
    <fieldset
      className="m-0 flex max-w-2xl flex-wrap gap-2 border-0 p-0"
      aria-label="Message images"
    >
      {images.map((resource) => (
        <Button
          key={resource.id}
          variant="unstyled"
          className="group/image relative overflow-hidden rounded-lg border border-border bg-bg-secondary"
          aria-label={`Open image ${resource.title}`}
          onClick={() => openViewer(String(sessionId), resource.id)}
        >
          <SessionResourcePreview
            resource={resource}
            sessionId={String(sessionId)}
            className="h-32 max-w-64 object-cover transition-transform group-hover/image:scale-[1.02]"
          />
          <span className="absolute inset-x-0 bottom-0 truncate bg-bg/80 px-2 py-1 text-left text-xs text-text-primary">
            {resource.title}
          </span>
        </Button>
      ))}
    </fieldset>
  )
}

export function SessionMessageImages({
  sessionId,
  messageId,
}: {
  readonly sessionId: SessionId | null
  readonly messageId: string
}) {
  return sessionId ? (
    <SessionMessageImagesForSession sessionId={sessionId} messageId={messageId} />
  ) : null
}
