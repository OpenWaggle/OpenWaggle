import { beforeEach, describe, expect, it, vi } from 'vitest'
import { closeBrowserTabs, confirmBrowserTabsClose } from '../workspace-browser-close'
import type { BrowserPreviewTabState } from '../workspace-panel-store'

const apiMocks = vi.hoisted(() => ({
  showConfirm: vi.fn(async () => true),
  closeBrowserPreview: vi.fn<(_id: string) => Promise<void>>(),
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
    apiMocks.closeBrowserPreview.mockResolvedValue(undefined)
  })

  it('closes human-controlled tabs without prompting', async () => {
    await expect(confirmBrowserTabsClose([browserTab('one')])).resolves.toBe(true)
    expect(apiMocks.showConfirm).not.toHaveBeenCalled()
  })

  it('retains failed tabs and waits for successful native destruction before publishing closed IDs', async () => {
    const failure = new Error('Native view is still live')
    const pending = Promise.withResolvers<void>()
    apiMocks.closeBrowserPreview.mockImplementation((id) =>
      id === 'failed' ? Promise.reject(failure) : pending.promise,
    )
    const completed = vi.fn()
    const result = closeBrowserTabs([browserTab('failed'), browserTab('pending')]).then(completed)
    await vi.waitFor(() => expect(apiMocks.closeBrowserPreview).toHaveBeenCalledTimes(2))
    expect(completed).not.toHaveBeenCalled()
    pending.resolve()
    await result
    expect(completed).toHaveBeenCalledExactlyOnceWith({
      closedIds: ['pending'],
      errors: [failure],
    })
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

  it('does not start native closure when the user cancels an agent-controlled tab close', async () => {
    apiMocks.showConfirm.mockResolvedValueOnce(false)
    await expect(
      closeBrowserTabs([browserTab('one', { kind: 'agent', action: 'click', pointer: null })]),
    ).resolves.toEqual({ closedIds: [], errors: [] })
    expect(apiMocks.closeBrowserPreview).not.toHaveBeenCalled()
  })

  it('closes launcher tabs without inventing a native close request', async () => {
    await expect(
      closeBrowserTabs([{ ...browserTab('launcher'), kind: 'launcher' }]),
    ).resolves.toEqual({
      closedIds: ['launcher'],
      errors: [],
    })
    expect(apiMocks.closeBrowserPreview).not.toHaveBeenCalled()
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
