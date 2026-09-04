import type { SessionId, SessionNodeId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionWorkspace } from '@shared/types/session'
import { messagePartToUIParts } from '@/features/chat/lib/useAgentChat.utils'

interface ResolveTranscriptMessagesInput {
  readonly activeSessionId: SessionId | null
  readonly activeSessionUpdatedAt?: number
  readonly activeWorkspace: SessionWorkspace | null
  readonly messages: UIMessage[]
  readonly draftBranchSourceNodeId?: SessionNodeId | null
}

function workspaceBelongsToSession(workspace: SessionWorkspace, sessionId: SessionId) {
  return String(workspace.tree.session.id) === String(sessionId)
}

function workspacePathToMessages(workspace: SessionWorkspace, messages: UIMessage[]) {
  const messagesById = new Map(messages.map((message) => [message.id, message]))
  const workspaceMessages: UIMessage[] = []

  for (const entry of workspace.transcriptPath) {
    const message = entry.node.message
    if (!message) {
      continue
    }

    const messageId = String(message.id)
    const existingMessage = messagesById.get(messageId)
    if (existingMessage) {
      workspaceMessages.push(existingMessage)
      continue
    }

    // Read once per message instead of re-walking message.metadata.* per branch.
    const branchSummary = message.metadata?.branchSummary
    const compactionSummary = message.metadata?.compactionSummary

    workspaceMessages.push({
      id: messageId,
      role: message.role,
      parts: message.parts.flatMap(messagePartToUIParts),
      createdAt: new Date(message.createdAt),
      ...(branchSummary || compactionSummary
        ? {
            metadata: {
              ...(branchSummary ? { branchSummary } : {}),
              ...(compactionSummary ? { compactionSummary } : {}),
            },
          }
        : {}),
    })
  }

  return workspaceMessages
}

function isViewingActiveBranchHead(workspace: SessionWorkspace) {
  const activeHeadNodeId = workspace.activeBranchId
    ? workspace.tree.branches.find((branch) => branch.id === workspace.activeBranchId)?.headNodeId
    : workspace.tree.session.lastActiveNodeId

  return (
    workspace.activeNodeId !== null &&
    activeHeadNodeId !== undefined &&
    activeHeadNodeId !== null &&
    String(workspace.activeNodeId) === String(activeHeadNodeId)
  )
}

function findLastWorkspaceMessageIndex(messages: UIMessage[], workspaceMessages: UIMessage[]) {
  const workspaceMessageIds = new Set(workspaceMessages.map((message) => message.id))

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message && workspaceMessageIds.has(message.id)) {
      return index
    }
  }

  return -1
}

function isViewingDraftBranchSource(
  workspace: SessionWorkspace,
  draftBranchSourceNodeId?: SessionNodeId | null,
) {
  return (
    workspace.activeNodeId !== null &&
    draftBranchSourceNodeId !== undefined &&
    draftBranchSourceNodeId !== null &&
    String(workspace.activeNodeId) === String(draftBranchSourceNodeId)
  )
}

function unsavedLiveTail(
  workspace: SessionWorkspace,
  messages: UIMessage[],
  lastWorkspaceMessageIndex: number,
) {
  const persistedMessageIds = new Set(
    workspace.tree.nodes.flatMap((node) => (node.message ? [String(node.message.id)] : [])),
  )

  return messages
    .slice(lastWorkspaceMessageIndex + 1)
    .filter((message) => !persistedMessageIds.has(message.id))
}

function appendLiveTailWhenViewingHeadOrDraftSource(
  workspace: SessionWorkspace,
  workspaceMessages: UIMessage[],
  messages: UIMessage[],
  activeSessionUpdatedAt?: number,
  draftBranchSourceNodeId?: SessionNodeId | null,
) {
  const viewingHead = isViewingActiveBranchHead(workspace)
  const viewingDraftSource = isViewingDraftBranchSource(workspace, draftBranchSourceNodeId)
  if (!viewingHead && !viewingDraftSource) {
    return workspaceMessages
  }

  const lastWorkspaceMessageIndex = findLastWorkspaceMessageIndex(messages, workspaceMessages)
  if (lastWorkspaceMessageIndex < 0) {
    // Session detail can refresh before the workspace after completion. Only treat the disjoint
    // detail as a replacement tail when freshness proves this is the active head, not a selected branch.
    const workspaceIsStale =
      activeSessionUpdatedAt !== undefined &&
      activeSessionUpdatedAt > workspace.tree.session.updatedAt
    if (!viewingHead || !workspaceIsStale) {
      return workspaceMessages
    }

    const replacementTail = unsavedLiveTail(workspace, messages, lastWorkspaceMessageIndex)
    return replacementTail.length > 0
      ? [...workspaceMessages, ...replacementTail]
      : workspaceMessages
  }
  if (lastWorkspaceMessageIndex === messages.length - 1) {
    return workspaceMessages
  }

  const tail = unsavedLiveTail(workspace, messages, lastWorkspaceMessageIndex)
  return tail.length > 0 ? [...workspaceMessages, ...tail] : workspaceMessages
}

export function resolveTranscriptMessages({
  activeSessionId,
  activeSessionUpdatedAt,
  activeWorkspace,
  messages,
  draftBranchSourceNodeId,
}: ResolveTranscriptMessagesInput): UIMessage[] {
  if (!activeSessionId || !activeWorkspace) {
    return messages
  }

  if (!workspaceBelongsToSession(activeWorkspace, activeSessionId)) {
    return messages
  }

  const workspaceMessages = workspacePathToMessages(activeWorkspace, messages)
  if (workspaceMessages.length === 0) {
    return messages
  }

  return appendLiveTailWhenViewingHeadOrDraftSource(
    activeWorkspace,
    workspaceMessages,
    messages,
    activeSessionUpdatedAt,
    draftBranchSourceNodeId,
  )
}
