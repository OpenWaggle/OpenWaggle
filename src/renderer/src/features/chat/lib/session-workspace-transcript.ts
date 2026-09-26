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

/*
 * Derived messages are cached by the identity of what they were derived from.
 *
 * Every render rebuilt every message with a fresh object, so each streamed token re-rendered every
 * mounted message bubble (about 1,000 re-rendered components per commit with 40 rows, 2,600 with
 * 140). A message that did not change now keeps its identity and its bubble bails out.
 */
const liveMessageWithNode = new WeakMap<UIMessage, { nodeId: string; message: UIMessage }>()
const persistedMessage = new WeakMap<object, { nodeId: string; message: UIMessage }>()

function withSessionNodeId(message: UIMessage, nodeId: string) {
  const cached = liveMessageWithNode.get(message)
  if (cached?.nodeId === nodeId) return cached.message
  const next = { ...message, metadata: { ...message.metadata, sessionNodeId: nodeId } }
  liveMessageWithNode.set(message, { nodeId, message: next })
  return next
}

function fromWorkspaceNode(
  message: NonNullable<SessionWorkspace['transcriptPath'][number]['node']['message']>,
  nodeId: string,
) {
  const cached = persistedMessage.get(message)
  if (cached?.nodeId === nodeId) return cached.message
  // Read once per message instead of re-walking message.metadata.* per branch.
  const branchSummary = message.metadata?.branchSummary
  const compactionSummary = message.metadata?.compactionSummary
  const next: UIMessage = {
    id: String(message.id),
    role: message.role,
    parts: message.parts.flatMap(messagePartToUIParts),
    createdAt: new Date(message.createdAt),
    metadata: {
      sessionNodeId: nodeId,
      ...(branchSummary ? { branchSummary } : {}),
      ...(compactionSummary ? { compactionSummary } : {}),
    },
  }
  persistedMessage.set(message, { nodeId, message: next })
  return next
}

function workspacePathToMessages(workspace: SessionWorkspace, messages: UIMessage[]) {
  const messagesById = new Map(messages.map((message) => [message.id, message]))
  const workspaceMessages: UIMessage[] = []

  for (const entry of workspace.transcriptPath) {
    const message = entry.node.message
    if (!message) continue
    const nodeId = String(entry.node.id)
    const existingMessage = messagesById.get(String(message.id))
    workspaceMessages.push(
      existingMessage
        ? withSessionNodeId(existingMessage, nodeId)
        : fromWorkspaceNode(message, nodeId),
    )
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

function isViewingSessionHead(workspace: SessionWorkspace) {
  if (!isViewingActiveBranchHead(workspace)) {
    return false
  }

  const sessionBranchId =
    workspace.tree.session.lastActiveBranchId ??
    workspace.tree.branches.find((branch) => branch.isMain)?.id

  return (
    workspace.activeBranchId !== null &&
    sessionBranchId !== undefined &&
    String(workspace.activeBranchId) === String(sessionBranchId)
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
    // detail as a replacement tail when freshness proves this is the session head, not the head
    // of another selected branch.
    const workspaceIsStale =
      activeSessionUpdatedAt !== undefined &&
      activeSessionUpdatedAt > workspace.tree.session.updatedAt
    if (!isViewingSessionHead(workspace) || !workspaceIsStale) {
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
