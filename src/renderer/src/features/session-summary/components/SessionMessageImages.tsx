import type { SessionId } from '@shared/types/brand'
import type { SessionResource } from '@shared/types/session-resource'
import { createContext, type ReactNode, useContext } from 'react'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'
import { useSessionImageResourcesByNodeIds } from '../hooks/useSessionResources'
import { isViewableSessionImage } from '../model/session-resource-viewability'
import { SessionResourcePreview } from './SessionResourcePreview'

interface SessionMessageResourceIndex {
  readonly sessionId: string
  readonly imagesByMessageId: ReadonlyMap<string, readonly SessionResource[]>
}

const SessionMessageResourcesContext = createContext<SessionMessageResourceIndex | null>(null)
const EMPTY_MESSAGE_IMAGES: readonly SessionResource[] = []

function indexMessageImages(sessionId: string, resources: readonly SessionResource[]) {
  const result = new Map<string, SessionResource[]>()
  for (const resource of resources) {
    if (String(resource.sessionId) !== sessionId || !isViewableSessionImage(resource)) continue
    const messageIds = new Set(
      resource.occurrences.flatMap((occurrence) =>
        occurrence.nodeId === null ? [] : [occurrence.nodeId],
      ),
    )
    for (const messageId of messageIds) {
      const images = result.get(messageId)
      if (images) images.push(resource)
      else result.set(messageId, [resource])
    }
  }
  return result
}

export function SessionMessageResourcesProvider({
  sessionId,
  nodeIds,
  children,
}: {
  readonly sessionId: SessionId | null
  readonly nodeIds: readonly string[]
  readonly children: ReactNode
}) {
  const id = sessionId ? String(sessionId) : null
  const resources = useSessionImageResourcesByNodeIds(id, nodeIds)
  const value: SessionMessageResourceIndex | null = id
    ? { sessionId: id, imagesByMessageId: indexMessageImages(id, resources.data ?? []) }
    : null
  return (
    <SessionMessageResourcesContext.Provider value={value}>
      {children}
    </SessionMessageResourcesContext.Provider>
  )
}

export function useSessionMessageImageResources(messageId: string) {
  const context = useContext(SessionMessageResourcesContext)
  return context?.imagesByMessageId.get(messageId) ?? EMPTY_MESSAGE_IMAGES
}

export function SessionMessageImages({ messageId }: { readonly messageId: string }) {
  const context = useContext(SessionMessageResourcesContext)
  const openViewer = useUIStore((state) => state.openResourceViewer)
  const images = useSessionMessageImageResources(messageId)

  if (!context || images.length === 0) return null

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
          onClick={() => openViewer(context.sessionId, resource.id)}
        >
          <SessionResourcePreview
            resource={resource}
            sessionId={context.sessionId}
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
