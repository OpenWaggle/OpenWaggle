import type { OAuthFlowStatus } from './auth'
import type { WorktreeLaunchEventPayload } from './background-run'
import type { SessionId } from './brand'
import type { AgentPhaseEventPayload } from './phase'
import type { AgentTransportEvent } from './stream'
import type { UpdateStatus } from './updater'
import type { WaggleStreamMetadata, WaggleTurnEvent } from './waggle'
import type { WorkspaceFilesChangedEvent } from './workspace-files'

export interface IpcSendChannelMap {
  'agent:cancel-waggle': {
    args: [sessionId: SessionId]
  }
  'terminal:write': {
    args: [terminalId: string, data: string]
  }
  'clipboard:write-text': {
    args: [text: string]
  }
}

/**
 * Event channels — one-way, main → renderer
 */
export interface IpcEventChannelMap {
  /** Pi-shaped runtime events for the renderer's live transcript runtime */
  'agent:event': {
    payload: { sessionId: SessionId; event: AgentTransportEvent }
  }
  'terminal:data': {
    payload: { terminalId: string; data: string }
  }
  'agent:phase': {
    payload: AgentPhaseEventPayload
  }
  'agent:run-completed': {
    payload: { sessionId: SessionId }
  }
  'sessions:resources-invalidated': {
    payload: { sessionId: SessionId }
  }
  'agent:worktree-launch': {
    payload: WorktreeLaunchEventPayload
  }
  'window:fullscreen-changed': {
    payload: boolean
  }
  'auth:oauth-status': {
    payload: OAuthFlowStatus
  }
  'waggle:event': {
    payload: {
      sessionId: SessionId
      event: AgentTransportEvent
      meta: WaggleStreamMetadata
    }
  }
  'waggle:turn-event': {
    payload: { sessionId: SessionId; event: WaggleTurnEvent }
  }
  'attachments:prepare-from-text-progress': {
    payload: {
      operationId: string
      bytesWritten: number
      totalBytes: number
      progressPercent: number
      stage: 'writing' | 'completed'
    }
  }
  'sessions:title-updated': {
    payload: { sessionId: SessionId; title: string }
  }
  'sessions:list-invalidated': {
    payload: { sessionIds: readonly SessionId[] }
  }
  /**
   * A working tree's git state changed because OpenWaggle mutated it.
   *
   * Path-scoped on purpose: a coarse "git changed" signal would make every open
   * session re-run a full `git diff` when one unrelated tree was staged, and diffs
   * here are expensive enough to carry an explicit maxBuffer (ADR 0018). Carries an
   * invalidation rather than computed state, so the schema stays decoupled from
   * consumers and large diffs stay off the IPC bus.
   */
  'git:working-tree-changed': {
    payload: { workingPath: string }
  }
  'workspace-files:changed': {
    payload: WorkspaceFilesChangedEvent
  }
  'updater:status-changed': {
    payload: UpdateStatus
  }
}
