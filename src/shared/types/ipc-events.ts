import type { OAuthFlowStatus } from './auth'
import type { SessionId } from './brand'
import type { AgentPhaseEventPayload } from './phase'
import type { AgentTransportEvent } from './stream'
import type { UpdateStatus } from './updater'
import type { WaggleStreamMetadata, WaggleTurnEvent } from './waggle'

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
  'updater:status-changed': {
    payload: UpdateStatus
  }
}
