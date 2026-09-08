import type { SessionId } from '@shared/types/brand'
import type { ProjectedResourceMessage } from './session-resource-backfill-messages'
import { attachmentOccurrenceId } from './session-resource-capture-attachment'
import { linkOccurrenceId } from './session-resource-capture-link'
import {
  toolResultCompletionOccurrenceIds,
  toolResultOccurrenceId,
  toolResultOutputGroups,
} from './session-resource-capture-tool'
import { collectExplicitResources } from './session-resource-extraction'

export function backfillCandidateOccurrenceIds(
  sessionId: SessionId,
  projectedMessages: readonly ProjectedResourceMessage[],
) {
  const ids: string[] = []
  for (const { message, nodeId, branchId } of projectedMessages) {
    const runId = `backfill:${nodeId}`
    if (message.role === 'user') {
      const attachments = message.parts.filter((part) => part.type === 'attachment')
      for (const [index, part] of attachments.entries()) {
        ids.push(
          attachmentOccurrenceId({
            sessionId,
            runId,
            attachment: part.attachment,
            index,
            nodeId,
            createdAt: message.createdAt,
            branchId,
          }),
        )
      }
      for (const [index, link] of collectExplicitResources(message.parts).links.entries()) {
        ids.push(
          linkOccurrenceId({
            sessionId,
            runId,
            link,
            index,
            nodeId,
            actor: 'user',
            activity: 'provided',
            createdAt: message.createdAt,
            branchId,
          }),
        )
      }
      continue
    }
    if (message.role !== 'assistant') continue
    let linkIndex = 0
    for (const part of message.parts) {
      if (part.type !== 'tool-result') continue
      const groups = toolResultOutputGroups(part.toolResult)
      if (groups.length === 0) continue
      ids.push(toolResultOccurrenceId({ sessionId, nodeId, toolResult: part.toolResult }))
      ids.push(
        ...toolResultCompletionOccurrenceIds({ sessionId, nodeId, toolResult: part.toolResult }),
      )
      for (const group of groups) {
        const links = collectExplicitResources(group.result).links
        for (const [localIndex, link] of links.entries()) {
          ids.push(
            linkOccurrenceId({
              sessionId,
              runId,
              link,
              index: linkIndex + localIndex,
              nodeId,
              actor: 'tool',
              activity: 'read',
              label: group.label,
              createdAt: message.createdAt,
              branchId,
            }),
          )
        }
        linkIndex += links.length
      }
    }
    const links = collectExplicitResources(
      message.parts.filter((part) => part.type === 'text'),
    ).links
    for (const [localIndex, link] of links.entries()) {
      ids.push(
        linkOccurrenceId({
          sessionId,
          runId,
          link,
          index: linkIndex + localIndex,
          nodeId,
          actor: 'agent',
          activity: 'read',
          createdAt: message.createdAt,
          branchId,
        }),
      )
    }
  }
  return [...new Set(ids)]
}
