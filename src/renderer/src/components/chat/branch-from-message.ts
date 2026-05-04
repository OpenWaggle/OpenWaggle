import { getMessageText as getAgentMessageText } from '@shared/types/agent'
import { SessionNodeId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionNode, SessionWorkspace } from '@shared/types/session'

interface CreateBranchDraftSelectionInput {
  readonly messages: readonly UIMessage[]
  readonly workspace: SessionWorkspace | null
  readonly messageId: string
}

export interface BranchDraftSelection {
  readonly sourceNodeId: SessionNodeId
  readonly routeNodeId: SessionNodeId
  readonly prefillText?: string
}

function getUiMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.content)
    .join('\n')
}

function isSummarizableAbandonedNode(node: SessionNode): boolean {
  return (
    node.kind === 'user_message' ||
    node.kind === 'assistant_message' ||
    node.kind === 'branch_summary' ||
    node.kind === 'compaction_summary' ||
    node.kind === 'custom'
  )
}

function pathToRootIds(
  nodesById: ReadonlyMap<string, SessionNode>,
  nodeId: SessionNodeId,
): ReadonlySet<string> {
  const pathIds = new Set<string>()
  let currentId: SessionNodeId | null = nodeId

  while (currentId) {
    const currentKey: string = String(currentId)
    if (pathIds.has(currentKey)) {
      break
    }
    pathIds.add(currentKey)
    currentId = nodesById.get(currentKey)?.parentId ?? null
  }

  return pathIds
}

function findTranscriptNode(
  workspace: SessionWorkspace | null,
  messageId: string,
): SessionNode | undefined {
  return workspace?.transcriptPath.find((entry) => String(entry.node.id) === messageId)?.node
}

export function createBranchDraftSelectionFromNode(node: SessionNode): BranchDraftSelection {
  if (node.kind === 'user_message' && node.parentId) {
    const text = node.message ? getAgentMessageText(node.message).trim() : ''
    return {
      sourceNodeId: node.parentId,
      routeNodeId: node.parentId,
      ...(text ? { prefillText: text } : {}),
    }
  }

  return {
    sourceNodeId: node.id,
    routeNodeId: node.id,
  }
}

export function createBranchDraftSelection({
  messages,
  workspace,
  messageId,
}: CreateBranchDraftSelectionInput): BranchDraftSelection {
  const message = messages.find((candidate) => candidate.id === messageId)
  const node = findTranscriptNode(workspace, messageId)

  if (message?.role === 'user' && node?.parentId) {
    const text = getUiMessageText(message).trim()
    return {
      sourceNodeId: node.parentId,
      routeNodeId: node.parentId,
      ...(text ? { prefillText: text } : {}),
    }
  }

  if (node) {
    return createBranchDraftSelectionFromNode(node)
  }

  const nodeId = SessionNodeId(messageId)
  return {
    sourceNodeId: nodeId,
    routeNodeId: nodeId,
  }
}

export function shouldPromptForBranchSummary(
  workspace: SessionWorkspace | null,
  targetNodeId: SessionNodeId,
): boolean {
  if (!workspace?.activeNodeId || workspace.activeNodeId === targetNodeId) {
    return false
  }

  const nodesById = new Map(workspace.tree.nodes.map((node) => [String(node.id), node]))
  const targetPathIds = pathToRootIds(nodesById, targetNodeId)
  let currentId: SessionNodeId | null = workspace.activeNodeId
  const visited = new Set<string>()

  while (currentId) {
    const currentKey: string = String(currentId)
    if (targetPathIds.has(currentKey) || visited.has(currentKey)) {
      return false
    }
    visited.add(currentKey)

    const currentNode = nodesById.get(currentKey)
    if (!currentNode) {
      return false
    }
    if (isSummarizableAbandonedNode(currentNode)) {
      return true
    }

    currentId = currentNode.parentId
  }

  return false
}
