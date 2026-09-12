import { api } from '@/shared/lib/ipc'
import type { BrowserPreviewTabState } from './workspace-panel-store'

export async function confirmBrowserTabsClose(tabs: readonly BrowserPreviewTabState[]) {
  if (!tabs.some((tab) => tab.controller.kind === 'agent')) return true
  if (tabs.length === 1) {
    return api.showConfirm(
      'Close browser while the agent is using it?',
      'The agent is actively controlling this browser. Closing it may interrupt the current browser action.',
    )
  }
  return api.showConfirm(
    'Close browsers while the agent is using them?',
    'The agent is actively controlling one or more of these browsers. Closing them may interrupt the current browser action.',
  )
}
