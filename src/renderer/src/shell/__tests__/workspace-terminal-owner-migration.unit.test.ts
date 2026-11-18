import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBrowserPreviewFloatingStore } from '@/features/browser-preview'
import { terminalSidePanelLayoutKey, useTerminalStore } from '@/features/terminal'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { isWorkspaceOwnerHandoffPending } from '@/shared/lib/workspace-owner-handoff'
import { useWorkspacePanelStore } from '../workspace-panel-store'
import { migrateTerminalOwner } from '../workspace-terminal-owner-migration'

const mocks = vi.hoisted(() => ({
  closeBrowserPreview: vi.fn<(_id: string) => Promise<void>>(),
  migrateTerminalOwner: vi.fn<(_from: string, _to: string) => Promise<void>>(async () => undefined),
  ensureBrowserPreviewOwnerRegistered: vi.fn(async (_owner: string) => undefined),
  unregisterBrowserPreviewOwner: vi.fn(async (_owner: string) => undefined),
  quiesceBrowserPreviewOwnerForHandoff: vi.fn(async (_owner: string) => undefined),
}))
vi.mock('@/shared/lib/ipc', () => ({ api: mocks }))
vi.mock('../browser-preview-owner-runtime', () => mocks)

const SOURCE = 'draft:/disposal'
const DESTINATION = 'session-disposal'

function setupOwners() {
  const terminal = useTerminalStore.getState().createTerminal(SOURCE, '/disposal')
  const side = useTerminalStore
    .getState()
    .createTerminal(terminalSidePanelLayoutKey(SOURCE), '/disposal')
  const first = useWorkspacePanelStore.getState().openBrowser(SOURCE, 'https://first.test/')
  const second = useWorkspacePanelStore.getState().openBrowser(SOURCE, 'https://second.test/')
  useBrowserPreviewFloatingStore.getState().open(SOURCE, second.previewId)
  return { terminal, side, first: first.previewId, second: second.previewId }
}

describe('workspace migration native preview disposal', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    useTerminalStore.setState({ groups: {}, activity: {}, exits: {}, portPreviews: {} })
    useWorkspacePanelStore.setState({ groups: {} })
    useBrowserPreviewFloatingStore.setState({ byOwnerKey: {} })
    useRightSidebarCoordinator.setState({ activeClaim: null })
    mocks.closeBrowserPreview.mockResolvedValue()
  })

  it('keeps browser tabs and their owner grant in the draft when native disposal remains rejected', async () => {
    const original = setupOwners()
    const group = useWorkspacePanelStore.getState().groups[SOURCE]
    const failure = new Error('Native preview close IPC failed')
    mocks.closeBrowserPreview.mockRejectedValue(failure)
    mocks.migrateTerminalOwner.mockImplementation(async () => {
      useTerminalStore.getState().ensureTerminal(SOURCE, 'deferred-setup', '/disposal')
    })
    await expect(migrateTerminalOwner(SOURCE, DESTINATION)).rejects.toMatchObject({
      cause: failure,
      message: expect.stringContaining('Browser tabs remain in the project draft'),
    })
    expect(useWorkspacePanelStore.getState().groups[SOURCE]).toBe(group)
    expect(useWorkspacePanelStore.getState().groups[DESTINATION]?.browserTabs ?? []).toEqual([])
    expect(useBrowserPreviewFloatingStore.getState().byOwnerKey[SOURCE]?.previewId).toBe(
      original.second,
    )
    expect(mocks.unregisterBrowserPreviewOwner).not.toHaveBeenCalledWith(SOURCE)
    expect(useTerminalStore.getState().groups[SOURCE]).toBeUndefined()
    expect(
      useTerminalStore
        .getState()
        .groups[DESTINATION]?.tabs.flatMap((tab) => tab.panes.map((pane) => pane.terminalId)),
    ).toEqual([original.terminal, 'deferred-setup'])
    expect(
      useTerminalStore.getState().groups[terminalSidePanelLayoutKey(DESTINATION)]?.tabs[0]?.panes[0]
        ?.terminalId,
    ).toBe(original.side)
    expect(isWorkspaceOwnerHandoffPending(SOURCE)).toBe(false)
    expect(isWorkspaceOwnerHandoffPending(DESTINATION)).toBe(false)
  })

  it('retries only rejected closures before publishing the new renderer owner', async () => {
    const original = setupOwners()
    const nativeOwners = new Map([
      [original.first, SOURCE],
      [original.second, SOURCE],
    ])
    const attempts = new Map<string, number>()
    mocks.closeBrowserPreview.mockImplementation(async (id) => {
      const attempt = (attempts.get(id) ?? 0) + 1
      attempts.set(id, attempt)
      expect(useWorkspacePanelStore.getState().groups[DESTINATION]).toBeUndefined()
      if (id === original.second && attempt === 1) throw new Error('Transient IPC failure')
      nativeOwners.delete(id)
    })
    const releaseEvents = await migrateTerminalOwner(SOURCE, DESTINATION)
    releaseEvents()
    expect(attempts.get(original.first)).toBe(1)
    expect(attempts.get(original.second)).toBe(2)
    expect(nativeOwners.size).toBe(0)
    expect(useWorkspacePanelStore.getState().groups[SOURCE]).toBeUndefined()
    expect(
      useWorkspacePanelStore
        .getState()
        .groups[DESTINATION]?.browserTabs.every((tab) => tab.ownerKey === DESTINATION),
    ).toBe(true)
    expect(mocks.unregisterBrowserPreviewOwner).toHaveBeenCalledExactlyOnceWith(SOURCE)
  })

  it('keeps the entire browser group draft-owned after mixed disposal results', async () => {
    const original = setupOwners()
    const failure = new Error('Second preview could not close')
    const nativeOwners = new Map([
      [original.first, SOURCE],
      [original.second, SOURCE],
    ])
    mocks.closeBrowserPreview.mockImplementation(async (id) => {
      if (id === original.second) throw failure
      nativeOwners.delete(id)
    })
    await expect(migrateTerminalOwner(SOURCE, DESTINATION)).rejects.toMatchObject({
      cause: failure,
    })
    const retained = useWorkspacePanelStore.getState().groups[SOURCE]?.browserTabs ?? []
    expect(retained.map((tab) => tab.id)).toEqual([original.first, original.second])
    for (const tab of retained) {
      expect(tab.ownerKey).toBe(SOURCE)
      expect(nativeOwners.get(tab.id) ?? SOURCE).toBe(tab.ownerKey)
    }
    expect(
      mocks.closeBrowserPreview.mock.calls.filter(([id]) => id === original.second),
    ).toHaveLength(2)
    expect(mocks.unregisterBrowserPreviewOwner).not.toHaveBeenCalledWith(SOURCE)
  })

  it('preserves the close failure and finishes side-panel reconciliation when persistence also fails', async () => {
    const original = setupOwners()
    useWorkspacePanelStore.getState().showTerminal(SOURCE)
    const closeFailure = new Error('Native close failed first')
    mocks.closeBrowserPreview.mockRejectedValue(closeFailure)
    const storage = useWorkspacePanelStore.persist.getOptions().storage
    if (!storage) throw new Error('Expected workspace persistence')
    const persist = vi.spyOn(storage, 'setItem').mockImplementationOnce(() => {
      throw new Error('Later persistence failure')
    })
    try {
      await expect(migrateTerminalOwner(SOURCE, DESTINATION)).rejects.toMatchObject({
        cause: closeFailure,
      })
      expect(
        useWorkspacePanelStore.getState().groups[SOURCE]?.browserTabs.map((tab) => tab.id),
      ).toEqual([original.first, original.second])
      expect(useWorkspacePanelStore.getState().groups[SOURCE]?.activeSurface?.kind).toBe('browser')
      expect(useWorkspacePanelStore.getState().groups[DESTINATION]?.activeSurface?.kind).toBe(
        'terminal',
      )
      expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
        kind: 'workspace',
        ownerKey: DESTINATION,
      })
      expect(
        useTerminalStore.getState().groups[terminalSidePanelLayoutKey(DESTINATION)]?.tabs[0]
          ?.panes[0]?.terminalId,
      ).toBe(original.side)
      expect(mocks.unregisterBrowserPreviewOwner).not.toHaveBeenCalledWith(SOURCE)
    } finally {
      persist.mockRestore()
    }
  })

  it.each([
    { panelOpen: true, foreignClaim: true },
    { panelOpen: false, foreignClaim: true },
    { panelOpen: true, foreignClaim: false },
  ])(
    'preserves side-terminal visibility and claims after rejected disposal: %j',
    async ({ panelOpen, foreignClaim }) => {
      setupOwners()
      const store = useWorkspacePanelStore.getState()
      store.showTerminal(SOURCE)
      store.setMaximized(SOURCE, true)
      if (!panelOpen) store.hidePanel(SOURCE)
      if (foreignClaim) useRightSidebarCoordinator.getState().claimWorkspace('unrelated-session')
      mocks.closeBrowserPreview.mockRejectedValue(new Error('Native close failed'))
      await expect(migrateTerminalOwner(SOURCE, DESTINATION)).rejects.toThrow('Browser tabs remain')
      expect(useWorkspacePanelStore.getState().groups[DESTINATION]).toMatchObject({
        browserTabs: [],
        activeSurface: { kind: 'terminal' },
        panelOpen,
        maximized: true,
      })
      expect(useWorkspacePanelStore.getState().groups[SOURCE]?.panelOpen).toBe(panelOpen)
      expect(useWorkspacePanelStore.getState().groups[SOURCE]?.activeSurface?.kind).toBe('browser')
      expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
        kind: 'workspace',
        ownerKey: foreignClaim ? 'unrelated-session' : DESTINATION,
      })
    },
  )
})
