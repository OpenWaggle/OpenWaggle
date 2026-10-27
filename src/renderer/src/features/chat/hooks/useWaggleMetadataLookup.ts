import type { UIMessage } from '@shared/types/chat-ui'
import type { SessionDetail, SessionWorkspace } from '@shared/types/session'
import {
  isInheritedWaggleModelBinding,
  type WaggleConfig,
  type WaggleMessageMetadata,
} from '@shared/types/waggle'
import { useWaggleStore } from '@/features/waggle/state'

const EMPTY_WAGGLE_METADATA_LOOKUP: Readonly<Record<string, WaggleMessageMetadata>> = Object.freeze(
  {},
)

interface LiveMetadataResolutionParams {
  readonly message: UIMessage
  readonly messageIndex: number
  readonly assistantIndex: number
  readonly lastUserMessageIndex: number
  readonly persistedMeta: ReadonlyMap<string, WaggleMessageMetadata>
  readonly liveMessageMetadata: Readonly<Record<string, WaggleMessageMetadata>>
  readonly completedTurnMeta: readonly WaggleMessageMetadata[]
  readonly initialTurnMeta: WaggleMessageMetadata | null
  readonly config: WaggleConfig
  readonly currentAgentIndex: number
  readonly currentAgentLabel: string
  readonly useRunningFallbacks: boolean
}

function getSessionConfig(
  session: SessionDetail | null,
  activeConfig: WaggleConfig | null,
  activeCollaborationId: string | null,
  configSessionId: string | null,
) {
  const owningId = activeCollaborationId ?? configSessionId
  const liveConfig = !owningId || owningId === session?.id ? activeConfig : null
  return liveConfig ?? session?.waggleConfig
}

function findLastUserMessageIndex(messages: readonly UIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return index
    }
  }
  return -1
}

function getCurrentAgentMetadata(params: LiveMetadataResolutionParams) {
  const agent = params.config.agents[params.currentAgentIndex]
  if (params.messageIndex <= params.lastUserMessageIndex || !agent) {
    return undefined
  }

  return {
    agentIndex: params.currentAgentIndex,
    agentLabel: params.currentAgentLabel,
    agentColor: agent.color,
    ...(!isInheritedWaggleModelBinding(agent.model) ? { agentModel: agent.model } : {}),
    turnNumber: params.completedTurnMeta.length,
  }
}

function resolveAssistantMetadata(params: LiveMetadataResolutionParams) {
  const liveMeta = params.liveMessageMetadata[params.message.id]
  if (liveMeta) {
    return liveMeta
  }

  const persisted = params.persistedMeta.get(params.message.id)
  if (persisted) {
    return persisted
  }

  if (!params.useRunningFallbacks) {
    return undefined
  }

  const completedMeta = params.completedTurnMeta[params.assistantIndex]
  if (completedMeta) {
    return completedMeta
  }

  if (
    params.messageIndex > params.lastUserMessageIndex &&
    params.completedTurnMeta.length === 0 &&
    params.initialTurnMeta
  ) {
    return params.initialTurnMeta
  }

  return getCurrentAgentMetadata(params)
}

type PersistedMessage = SessionDetail['messages'][number]

function addPersistedMeta(map: Map<string, WaggleMessageMetadata>, message: PersistedMessage) {
  if (message.role !== 'assistant') return
  const meta = message.metadata?.waggle
  if (meta) map.set(String(message.id), meta)
}

/**
 * Persisted Waggle metadata by message id. The detail holds only a long Session's newest messages
 * (ADR 0036), so the loaded workspace's transcript window, which reaches further back, adds its own.
 */
function buildPersistedMetaMap(session: SessionDetail | null, workspace: SessionWorkspace | null) {
  const map = new Map<string, WaggleMessageMetadata>()
  if (workspace && session && String(workspace.tree.session.id) === String(session.id)) {
    for (const entry of workspace.transcriptPath) {
      if (entry.node.message) addPersistedMeta(map, entry.node.message)
    }
  }
  for (const message of session?.messages ?? []) addPersistedMeta(map, message)
  return map
}

/**
 * Derives a UIMessage-id -> Waggle metadata lookup without broad subscriptions
 * or position-only attribution. Live stream metadata wins, persisted metadata is
 * the historical source of truth, and current-agent hints are only a live fallback.
 */
export function useWaggleMetadataLookup(
  session: SessionDetail | null,
  messages: UIMessage[],
  workspace: SessionWorkspace | null = null,
): Readonly<Record<string, WaggleMessageMetadata>> {
  const activeConfig = useWaggleStore((s) => s.activeConfig)
  const activeCollaborationId = useWaggleStore((s) => s.activeCollaborationId)
  const configSessionId = useWaggleStore((s) => s.configSessionId)
  const completedTurnMeta = useWaggleStore((s) => s.completedTurnMeta)
  const initialTurnMeta = useWaggleStore((s) => s.initialTurnMeta)
  const liveMessageMetadata = useWaggleStore((s) => s.liveMessageMetadata)
  const status = useWaggleStore((s) => s.status)
  const currentAgentIndex = useWaggleStore((s) => s.currentAgentIndex)
  const currentAgentLabel = useWaggleStore((s) => s.currentAgentLabel)

  const config = getSessionConfig(session, activeConfig, activeCollaborationId, configSessionId)
  if (!config) {
    return EMPTY_WAGGLE_METADATA_LOOKUP
  }

  const lookup: Record<string, WaggleMessageMetadata> = {}
  const persistedMeta = buildPersistedMetaMap(session, workspace)
  const lastUserMessageIndex = findLastUserMessageIndex(messages)
  const isLive = status === 'running'
  let assistantIndex = 0

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = messages[messageIndex]
    if (message?.role !== 'assistant') {
      continue
    }

    const meta = resolveAssistantMetadata({
      message,
      messageIndex,
      assistantIndex,
      lastUserMessageIndex,
      persistedMeta,
      liveMessageMetadata,
      completedTurnMeta,
      initialTurnMeta,
      config,
      currentAgentIndex,
      currentAgentLabel,
      useRunningFallbacks: isLive,
    })
    if (meta) {
      lookup[message.id] = meta
    }
    assistantIndex += 1
  }

  return Object.freeze(lookup)
}
