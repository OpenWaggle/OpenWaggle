/**
 * Renderer-facing feedback and diagnostics API.
 *
 * Split out of `openwaggle-api.ts`, which is at its line limit. These six calls form one flow:
 * check the GitHub CLI, gather diagnostics and logs, preview the report, then submit or open it.
 */
import type { IpcInvokeMethod } from './ipc-api-methods'

export interface OpenWaggleFeedbackApi {
  checkGhCli: IpcInvokeMethod<'feedback:check-gh'>
  collectDiagnostics: IpcInvokeMethod<'feedback:collect-diagnostics'>
  getRecentLogs: IpcInvokeMethod<'feedback:get-recent-logs'>
  submitFeedback: IpcInvokeMethod<'feedback:submit'>
  generateFeedbackMarkdown: IpcInvokeMethod<'feedback:generate-markdown'>
  openExternal: IpcInvokeMethod<'shell:open-external'>
}
