import type { AgentStreamEvent } from '@shared/types/agent'
import { BrowserWindow } from 'electron'

/**
 * Send an agent stream event to all renderer windows.
 */
export function emitAgentEvent(event: AgentStreamEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('agent:event', event)
    }
  }
}
