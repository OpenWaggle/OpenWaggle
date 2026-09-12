import { api } from '@/shared/lib/ipc'
import type { BrowserPreviewTabState } from './workspace-panel-store'

/** Keep failed native tabs available for retry instead of discarding their renderer identity. */
export async function closeBrowserTabs(tabs: readonly BrowserPreviewTabState[]) {
  const errors: unknown[] = []
  if (!(await confirmBrowserTabsClose(tabs))) return { closedIds: [], errors }
  const closed = await Promise.all(
    tabs.map(async (tab) => {
      try {
        if (tab.kind === 'preview') await api.closeBrowserPreview(tab.id)
        return tab.id
      } catch (error) {
        errors.push(error)
        return null
      }
    }),
  )
  return { closedIds: closed.filter((id) => id !== null), errors }
}

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
