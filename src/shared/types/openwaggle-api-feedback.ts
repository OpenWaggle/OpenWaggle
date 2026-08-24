/**
 * Renderer-facing feedback and diagnostics API.
 *
 * Split out of `openwaggle-api.ts`, which is at its line limit. These six calls form one flow:
 * check the GitHub CLI, gather diagnostics and logs, preview the report, then submit or open it.
 */
import type {
  DiagnosticsInfo,
  FeedbackPayload,
  FeedbackSubmitResult,
  GhCliStatus,
} from './feedback'

export interface OpenWaggleFeedbackApi {
  checkGhCli(): Promise<GhCliStatus>
  collectDiagnostics(): Promise<DiagnosticsInfo>
  getRecentLogs(lineCount: number): Promise<string>
  submitFeedback(payload: FeedbackPayload): Promise<FeedbackSubmitResult>
  generateFeedbackMarkdown(payload: FeedbackPayload): Promise<string>
  openExternal(url: string): Promise<void>
}
