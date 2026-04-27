import type { ConversationId, SessionNodeId } from '@shared/types/brand'
import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionWorkspace } from '@shared/types/session'
import { messagePartToUIParts } from '@/hooks/useAgentChat.utils'

interface ResolveTranscriptMessagesInput {
  readonly activeConversationId: ConversationId | null
  readonly activeWorkspace: SessionWorkspace | null
  readonly isRunning: boolean
  readonly messages: UIMessage[]
  readonly draftBranchSourceNodeId?: SessionNodeId | null
}

function workspaceBelongsToConversation(
  workspace: SessionWorkspace,
  conversationId: ConversationId,
): boolean {
  return String(workspace.tree.session.id) === String(conversationId)
}

function workspacePathToMessages(workspace: SessionWorkspace, messages: UIMessage[]): UIMessage[] {
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

    workspaceMessages.push({
      id: messageId,
      role: message.role,
      parts: message.parts.flatMap(messagePartToUIParts),
      createdAt: new Date(message.createdAt),
      ...(message.metadata?.compactionSummary
        ? { metadata: { compactionSummary: message.metadata.compactionSummary } }
        : {}),
    })
  }

  return workspaceMessages
}

function isViewingActiveBranchHead(workspace: SessionWorkspace): boolean {
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

function findLastWorkspaceMessageIndex(
  messages: UIMessage[],
  workspaceMessages: UIMessage[],
): number {
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
): boolean {
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
): UIMessage[] {
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
  draftBranchSourceNodeId?: SessionNodeId | null,
): UIMessage[] {
  const viewingHead = isViewingActiveBranchHead(workspace)
  const viewingDraftSource = isViewingDraftBranchSource(workspace, draftBranchSourceNodeId)
  if (!viewingHead && !viewingDraftSource) {
    return workspaceMessages
  }

  const lastWorkspaceMessageIndex = findLastWorkspaceMessageIndex(messages, workspaceMessages)
  if (lastWorkspaceMessageIndex < 0 || lastWorkspaceMessageIndex === messages.length - 1) {
    return workspaceMessages
  }

  const tail = viewingHead
    ? messages.slice(lastWorkspaceMessageIndex + 1)
    : unsavedLiveTail(workspace, messages, lastWorkspaceMessageIndex)
  return tail.length > 0 ? [...workspaceMessages, ...tail] : workspaceMessages
}

export function resolveTranscriptMessages({
  activeConversationId,
  activeWorkspace,
  isRunning,
  messages,
  draftBranchSourceNodeId,
}: ResolveTranscriptMessagesInput): UIMessage[] {
  if (!activeConversationId || !activeWorkspace) {
    return messages
  }

  if (!workspaceBelongsToConversation(activeWorkspace, activeConversationId)) {
    return messages
  }

  const workspaceMessages = workspacePathToMessages(activeWorkspace, messages)
  if (workspaceMessages.length === 0) {
    return messages
  }

  return isRunning
    ? appendLiveTailWhenViewingHeadOrDraftSource(
        activeWorkspace,
        workspaceMessages,
        messages,
        draftBranchSourceNodeId,
      )
    : workspaceMessages
}
