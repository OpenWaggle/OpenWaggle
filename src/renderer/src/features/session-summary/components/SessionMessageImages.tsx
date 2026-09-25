import type { SessionId } from '@shared/types/brand'
import type { SessionResource, SessionResourceOccurrence } from '@shared/types/session-resource'
import { createContext, type ReactNode, useContext, useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { useUIStore } from '@/shell/ui-store'
import { useSessionImageResourcesByNodeIds } from '../hooks/useSessionResources'
import { isViewableSessionImage } from '../model/session-resource-viewability'
import { SessionResourcePreview } from './SessionResourcePreview'

interface SessionMessageResourceIndex {
  readonly sessionId: string
  readonly imagesByMessageId: ReadonlyMap<string, readonly MessageImage[]>
}

interface MessageImage {
  readonly resource: SessionResource
  readonly occurrence: SessionResourceOccurrence
  readonly title: string
  readonly attachmentIndex: number | null
}

const SessionMessageResourcesContext = createContext<SessionMessageResourceIndex | null>(null)
const EMPTY_MESSAGE_IMAGES: readonly MessageImage[] = []

function providedAttachmentIndex(occurrence: SessionResourceOccurrence) {
  const value = /:provided:attachment:.*:(\d+)$/u.exec(occurrence.id)?.[1]
  return value === undefined ? null : Number(value)
}

function imageSlot(occurrence: SessionResourceOccurrence) {
  const generated = /:created:image:(\d+):/u.exec(occurrence.id)?.[1]
  if (generated !== undefined) return Number(generated)
  const linked = /:(?:provided|read|created|updated):link:(\d+):/u.exec(occurrence.id)?.[1]
  return linked === undefined ? providedAttachmentIndex(occurrence) : Number(linked)
}

function compareMessageImages(left: MessageImage, right: MessageImage) {
  const attachmentRank = (image: MessageImage) =>
    image.occurrence.actor === 'user' && providedAttachmentIndex(image.occurrence) !== null ? 0 : 1
  const typeDifference = attachmentRank(left) - attachmentRank(right)
  if (typeDifference !== 0) return typeDifference

  const hasOrder = (image: MessageImage) => image.occurrence.displayOrder != null
  if (hasOrder(left) !== hasOrder(right)) return hasOrder(left) ? -1 : 1
  const leftPosition = left.occurrence.displayOrder ?? imageSlot(left.occurrence)
  const rightPosition = right.occurrence.displayOrder ?? imageSlot(right.occurrence)
  if (leftPosition !== null && rightPosition !== null && leftPosition !== rightPosition) {
    return leftPosition - rightPosition
  }
  return (
    left.occurrence.createdAt - right.occurrence.createdAt ||
    left.occurrence.id.localeCompare(right.occurrence.id)
  )
}

function indexMessageImages(sessionId: string, resources: readonly SessionResource[]) {
  const result = new Map<string, MessageImage[]>()
  for (const resource of resources) {
    if (String(resource.sessionId) !== sessionId || !isViewableSessionImage(resource)) continue
    for (const occurrence of resource.occurrences) {
      const messageId = occurrence.nodeId
      if (messageId === null) continue
      const images = result.get(messageId)
      const image = {
        resource,
        occurrence,
        title:
          occurrence.displayName ??
          (occurrence.actor === 'user' && occurrence.activity === 'provided'
            ? (occurrence.label ?? resource.title)
            : resource.title),
        attachmentIndex: providedAttachmentIndex(occurrence),
      }
      if (images) images.push(image)
      else result.set(messageId, [image])
    }
  }
  for (const images of result.values()) images.sort(compareMessageImages)
  return result
}

const EMPTY_RESOURCES: readonly SessionResource[] = []

function resourceSignature(resources: readonly SessionResource[]) {
  return resources
    .map(
      (resource) =>
        `${resource.id}:${String(resource.updatedAt)}:${resource.occurrences.map((occurrence) => occurrence.id).join(',')}`,
    )
    .join(';')
}

function buildResourceIndex(
  id: string | null,
  resources: readonly SessionResource[],
): SessionMessageResourceIndex | null {
  return id ? { sessionId: id, imagesByMessageId: indexMessageImages(id, resources) } : null
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
  const data = resources.data ?? EMPTY_RESOURCES
  /*
   * Held until its contents change. A new index on every render re-rendered every consumer, one or
   * two per mounted message, on every streamed token (ADR 0036).
   */
  const signature = `${id ?? ''}|${resourceSignature(data)}`
  const [held, setHeld] = useState<{
    signature: string
    value: SessionMessageResourceIndex | null
  }>(() => ({ signature, value: buildResourceIndex(id, data) }))
  let value = held.value
  if (held.signature !== signature) {
    value = buildResourceIndex(id, data)
    setHeld({ signature, value })
  }
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

export function SessionMessageImages({
  messageId,
  attachmentNames,
}: {
  readonly messageId: string
  readonly attachmentNames?: readonly string[]
}) {
  const context = useContext(SessionMessageResourcesContext)
  const openViewer = useUIStore((state) => state.openResourceViewer)
  const images = context?.imagesByMessageId.get(messageId) ?? EMPTY_MESSAGE_IMAGES

  if (!context || images.length === 0) return null
  const galleryResourceIds = images.map(({ resource }) => resource.id)
  const hasRepeatedResources = new Set(galleryResourceIds).size !== galleryResourceIds.length
  const galleryTitles = images.map(
    ({ resource, title, attachmentIndex }) =>
      (attachmentIndex === null ? null : attachmentNames?.[attachmentIndex]) ??
      title ??
      resource.title,
  )
  const hasOccurrenceTitles = images.some(
    ({ resource }, index) => galleryTitles[index] !== resource.title,
  )

  return (
    <fieldset
      className="session-message-image-grid m-0 grid w-52 max-w-full gap-2 border-0 p-0"
      aria-label="Message images"
    >
      {images.map(({ resource, occurrence }, index) => (
        <Button
          key={occurrence.id}
          variant="unstyled"
          className="group/image aspect-[4/3] min-w-0 overflow-hidden rounded-lg border border-border bg-bg-secondary"
          aria-label={`Open image ${galleryTitles[index]}`}
          onClick={() =>
            openViewer(
              context.sessionId,
              resource.id,
              galleryResourceIds,
              hasRepeatedResources ? index : undefined,
              hasOccurrenceTitles ? galleryTitles : undefined,
            )
          }
        >
          <SessionResourcePreview
            resource={resource}
            sessionId={context.sessionId}
            className="size-full object-cover transition-transform group-hover/image:scale-[1.02]"
          />
        </Button>
      ))}
    </fieldset>
  )
}
