import { beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmBrowserTabsClose } from '../workspace-browser-close'
import type { BrowserPreviewTabState } from '../workspace-panel-store'

const apiMocks = vi.hoisted(() => ({
  showConfirm: vi.fn(async () => true),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: apiMocks }))

function browserTab(
  id: string,
  controller: BrowserPreviewTabState['controller'] = { kind: 'human' },
): BrowserPreviewTabState {
  return {
    id,
    ownerKey: 'session-1',
    kind: 'preview',
    profileId: 'default',
    url: `https://example.com/${id}`,
    title: id,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    error: null,
    audioMuted: false,
    audible: false,
    favicon: null,
    controller,
  }
}

describe('browser tab close confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.showConfirm.mockResolvedValue(true)
  })

  it('closes human-controlled tabs without prompting', async () => {
    await expect(confirmBrowserTabsClose([browserTab('one')])).resolves.toBe(true)
    expect(apiMocks.showConfirm).not.toHaveBeenCalled()
  })

  it('uses the stable single-tab warning and respects cancellation', async () => {
    apiMocks.showConfirm.mockResolvedValueOnce(false)

    await expect(
      confirmBrowserTabsClose([
        browserTab('one', { kind: 'agent', action: 'click', pointer: null }),
      ]),
    ).resolves.toBe(false)
    expect(apiMocks.showConfirm).toHaveBeenCalledExactlyOnceWith(
      'Close browser while the agent is using it?',
      'The agent is actively controlling this browser. Closing it may interrupt the current browser action.',
    )
  })

  it('uses the plural warning and permits a confirmed bulk close', async () => {
    await expect(
      confirmBrowserTabsClose([
        browserTab('one'),
        browserTab('two', { kind: 'agent', action: 'type', pointer: null }),
      ]),
    ).resolves.toBe(true)
    expect(apiMocks.showConfirm).toHaveBeenCalledExactlyOnceWith(
      'Close browsers while the agent is using them?',
      'The agent is actively controlling one or more of these browsers. Closing them may interrupt the current browser action.',
    )
  })
})
