import type { AgentSendPayload, AgentSendReport } from './agent'
import type { SessionId, WagglePresetId } from './brand'
import type { IpcEventPayload } from './ipc'
import type { SupportedModelId } from './llm'
import type { WaggleConfig, WagglePreset } from './waggle'

/** The Waggle-mode surface of the preload API, split out to keep the main interface within its size budget. */
export interface OpenWaggleWaggleApi {
  // Waggle mode
  sendWaggleMessage(
    sessionId: SessionId,
    payload: AgentSendPayload,
    model: SupportedModelId,
    config: WaggleConfig,
  ): Promise<AgentSendReport>
  cancelWaggle(sessionId: SessionId): void
  onWaggleEvent(callback: (payload: IpcEventPayload<'waggle:event'>) => void): () => void
  onWaggleTurnEvent(callback: (payload: IpcEventPayload<'waggle:turn-event'>) => void): () => void
  // Waggle presets
  listWagglePresets(projectPath?: string | null): Promise<WagglePreset[]>
  saveWagglePreset(preset: WagglePreset, projectPath?: string | null): Promise<WagglePreset>
  deleteWagglePreset(id: WagglePresetId, projectPath?: string | null): Promise<void>
}
