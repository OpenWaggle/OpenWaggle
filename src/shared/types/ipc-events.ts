import type { OAuthFlowStatus } from './auth'
import type { WorktreeLaunchEventPayload } from './background-run'
import type { SessionId } from './brand'
import type {
  BrowserPreviewKeyEvent,
  BrowserPreviewShortcutEvent,
  BrowserPreviewState,
} from './browser-preview'
import type {
  BrowserPreviewOpenRequest,
  BrowserPreviewOpenRequestCancellation,
} from './browser-preview-owner'
import type {
  BrowserPreviewRecordingCancelRequest,
  BrowserPreviewRecordingRequest,
} from './browser-preview-recording-request'
import type { AgentPhaseEventPayload } from './phase'
import type { AgentTransportEvent } from './stream'
import type { TerminalActivitySnapshot, TerminalEventPayload } from './terminal'
import type { UpdateStatus } from './updater'
import type { GitActionProgressEvent } from './vcs'
import type { WaggleStreamMetadata, WaggleTurnEvent } from './waggle'
import type { WorkspaceFilesChangedEvent } from './workspace-files'

export interface IpcSendChannelMap {
  'sessions:resources:activate-owner': {
    args: [sessionId: SessionId | null]
  }
  'agent:cancel-waggle': {
    args: [sessionId: SessionId]
  }
  'terminal:ack-output': {
    args: [ownerKey: string, terminalId: string, outputGeneration: number, endOffset: number]
  }
  'clipboard:write-text': {
    args: [text: string]
  }
}

/**
 * Event channels — one-way, main → renderer
 */
export interface IpcEventChannelMap {
  'browser-preview:open-request': {
    payload: BrowserPreviewOpenRequest
  }
  'browser-preview:cancel-open-request': {
    payload: BrowserPreviewOpenRequestCancellation
  }
  'browser-preview:state': {
    payload: BrowserPreviewState
  }
  'browser-preview:shortcut': {
    payload: BrowserPreviewShortcutEvent
  }
  'browser-preview:key-event': {
    payload: BrowserPreviewKeyEvent
  }
  'browser-preview:recording-request': {
    payload: BrowserPreviewRecordingRequest
  }
  'browser-preview:recording-cancel': {
    payload: BrowserPreviewRecordingCancelRequest
  }
  /** Pi-shaped runtime events for the renderer's live transcript runtime */
  'agent:event': {
    payload: { sessionId: SessionId; event: AgentTransportEvent }
  }
  'terminal:event': {
    payload: TerminalEventPayload
  }
  /** Global terminal child-process metadata, including terminals with no mounted pane. */
  'terminal:activity-snapshot': {
    payload: TerminalActivitySnapshot
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
  'git:stacked-action:progress': {
    payload: {
      operationId: string
      workingPath: string
      progress: GitActionProgressEvent
    }
  }
  'workspace-files:changed': {
    payload: WorkspaceFilesChangedEvent
  }
  'updater:status-changed': {
    payload: UpdateStatus
  }
}
