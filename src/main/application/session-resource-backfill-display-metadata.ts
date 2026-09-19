import type { SessionId } from '@shared/types/brand'
import type { SessionResourceDisplayMetadata } from '../ports/session-resource-repository'
import type { ProjectedResourceMessage } from './session-resource-backfill-messages'
import { attachmentOccurrenceId } from './session-resource-capture-attachment'
import { generatedImageOccurrencePrefix } from './session-resource-capture-image'
import { linkOccurrenceId } from './session-resource-capture-link'
import { imageFileName } from './session-resource-capture-shared'
import { collectExplicitResources } from './session-resource-extraction'
import { assistantMessageResourcePlan } from './session-resource-image-positions'

function imageMetadata(
  sessionId: SessionId,
  nodeId: string,
  index: number,
  title: string,
  mimeType: string,
  displayOrder: number | null | undefined,
): SessionResourceDisplayMetadata | null {
  if (displayOrder == null) return null
  return {
    value: generatedImageOccurrencePrefix({ sessionId, nodeId, index }),
    prefix: true,
    displayName: imageFileName(title, mimeType),
    displayOrder,
  }
}

function linkMetadata(
  sessionId: SessionId,
  projected: ProjectedResourceMessage,
  link: ReturnType<typeof collectExplicitResources>['links'][number],
  index: number,
  actor: 'user' | 'tool' | 'agent',
  displayOrder: number | null | undefined,
): SessionResourceDisplayMetadata | null {
  if (!link.image || displayOrder == null) return null
  const { message, nodeId, branchId } = projected
  return {
    value: linkOccurrenceId({
      sessionId,
      runId: `backfill:${nodeId}`,
      link,
      index,
      nodeId,
      branchId,
      actor,
      activity: actor === 'user' ? 'provided' : 'read',
      createdAt: message.createdAt,
    }),
    prefix: false,
    displayName: link.title,
    displayOrder,
  }
}

function userDisplayMetadata(sessionId: SessionId, projected: ProjectedResourceMessage) {
  const metadata: SessionResourceDisplayMetadata[] = []
  const { message, nodeId, branchId } = projected
  const attachments = message.parts.filter((part) => part.type === 'attachment')
  for (const [index, part] of attachments.entries()) {
    if (part.attachment.kind !== 'image') continue
    metadata.push({
      value: attachmentOccurrenceId({
        sessionId,
        runId: `backfill:${nodeId}`,
        attachment: part.attachment,
        index,
        nodeId,
        branchId,
        createdAt: message.createdAt,
      }),
      prefix: false,
      displayName: part.attachment.name,
      displayOrder: index,
    })
  }
  const links = collectExplicitResources(message.parts).links
  for (const [index, link] of links.entries()) {
    const entry = linkMetadata(
      sessionId,
      projected,
      link,
      index,
      'user',
      attachments.length + index,
    )
    if (entry) metadata.push(entry)
  }
  return metadata
}

function assistantDisplayMetadata(sessionId: SessionId, projected: ProjectedResourceMessage) {
  const metadata: SessionResourceDisplayMetadata[] = []
  const { message, nodeId } = projected
  const plan = assistantMessageResourcePlan(message)
  let imageIndex = 0
  let linkIndex = 0
  for (const result of plan.toolResults) {
    for (const group of result.groups) {
      for (const [localIndex, image] of group.resources.images.entries()) {
        const entry = imageMetadata(
          sessionId,
          nodeId,
          imageIndex + localIndex,
          image.title,
          image.mimeType,
          group.positions.images[localIndex],
        )
        if (entry) metadata.push(entry)
      }
      imageIndex += group.resources.images.length
      for (const [localIndex, link] of group.resources.links.entries()) {
        const entry = linkMetadata(
          sessionId,
          projected,
          link,
          linkIndex + localIndex,
          'tool',
          group.positions.links[localIndex],
        )
        if (entry) metadata.push(entry)
      }
      linkIndex += group.resources.links.length
    }
  }
  for (const [localIndex, image] of plan.textResources.images.entries()) {
    const entry = imageMetadata(
      sessionId,
      nodeId,
      imageIndex + localIndex,
      image.title,
      image.mimeType,
      plan.textPositions.images[localIndex],
    )
    if (entry) metadata.push(entry)
  }
  for (const [localIndex, link] of plan.textResources.links.entries()) {
    const entry = linkMetadata(
      sessionId,
      projected,
      link,
      linkIndex + localIndex,
      'agent',
      plan.textPositions.links[localIndex],
    )
    if (entry) metadata.push(entry)
  }
  return metadata
}

/** Metadata-only replay for catalogs populated by earlier builds of this feature. */
export function backfillDisplayMetadata(
  sessionId: SessionId,
  projectedMessages: readonly ProjectedResourceMessage[],
): readonly SessionResourceDisplayMetadata[] {
  const metadata: SessionResourceDisplayMetadata[] = []
  for (const projected of projectedMessages) {
    if (projected.message.role === 'user') {
      metadata.push(...userDisplayMetadata(sessionId, projected))
      continue
    }
    if (projected.message.role !== 'assistant') continue
    metadata.push(...assistantDisplayMetadata(sessionId, projected))
  }
  return metadata
}
