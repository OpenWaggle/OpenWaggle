import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { act, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBrowserPreviewFloatingStore } from '@/features/browser-preview'
import { useChatStore } from '@/features/chat/state'
import {
  rememberTerminalLayoutFocus,
  resolveTerminalCommandLayoutOwner,
  terminalSidePanelLayoutKey,
  useTerminalStore,
} from '@/features/terminal'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { isWorkspaceOwnerHandoffPending } from '@/shared/lib/workspace-owner-handoff'
import { unregisterBrowserPreviewOwner } from '../browser-preview-owner-runtime'
import { useUIStore } from '../ui-store'
import { WorkspaceTerminal } from '../WorkspaceTerminal'
import { useWorkspacePanelStore } from '../workspace-panel-store'

const mocks = vi.hoisted(() => {
  const context: { activeSession: SessionDetail | null } = { activeSession: null }
  return {
    context,
    beginTerminalEventOwnerHandoff: vi.fn(() => vi.fn()),
    createSession: vi.fn<() => Promise<SessionDetail>>(),
    listSessions: vi.fn(async () => []),
    getSessionTree: vi.fn(async () => null),
    migrateTerminalOwner: vi.fn<(_from: string, _to: string) => Promise<void>>(
      async () => undefined,
    ),
    closeBrowserPreview: vi.fn(async (_id: string) => undefined),
  }
})
vi.mock('@/features/chat/hooks', () => ({ useChat: () => mocks.context }))
vi.mock('@/features/terminal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/terminal')>()),
  beginTerminalEventOwnerHandoff: mocks.beginTerminalEventOwnerHandoff,
}))
vi.mock('@/features/sessions/hooks', () => ({ useProject: () => ({ projectPath: '/repo' }) }))
vi.mock('@/features/terminal/components', () => ({
  TerminalPanel: ({ ownerKey }: { readonly ownerKey: string }) => <section>{ownerKey}</section>,
}))
vi.mock('@/shared/lib/ipc', () => ({ api: mocks }))
vi.mock('../browser-preview-owner-runtime', () => ({
  ensureBrowserPreviewOwnerRegistered: vi.fn(async () => undefined),
  unregisterBrowserPreviewOwner: vi.fn(async () => undefined),
  quiesceBrowserPreviewOwnerForHandoff: vi.fn(async () => undefined),
}))

const DRAFT = 'draft:/repo'
const SESSION: SessionDetail = {
  id: SessionId('created-session'),
  title: 'Session',
  projectPath: '/repo',
  messages: [],
  createdAt: 1,
  updatedAt: 1,
}

function createTerminal(ownerKey: string) {
  const terminalId = useTerminalStore.getState().createTerminal(ownerKey, '/repo')
  useTerminalStore.getState().setPanelOpen(ownerKey, true)
  return terminalId
}

async function authorizeCreation() {
  await useChatStore.getState().createSession('/repo')
}

describe('WorkspaceTerminal draft materialization authority', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.migrateTerminalOwner.mockResolvedValue(undefined)
    mocks.createSession.mockResolvedValue(SESSION)
    mocks.context.activeSession = null
    useChatStore.getState().startDraftSession('/repo')
    useTerminalStore.setState({ groups: {}, activity: {}, exits: {}, portPreviews: {} })
    useWorkspacePanelStore.setState({ groups: {} })
  })

  it('keeps both owners intact when navigating from a draft to an existing Session', async () => {
    const draftTerminal = createTerminal(DRAFT)
    const sessionTerminal = createTerminal(SESSION.id)
    const draftPreview = useWorkspacePanelStore.getState().openBrowser(DRAFT, 'https://draft.test')
    const sessionPreview = useWorkspacePanelStore
      .getState()
      .openBrowser(SESSION.id, 'https://session.test')
    const view = render(<WorkspaceTerminal />)
    mocks.context.activeSession = SESSION
    view.rerender(<WorkspaceTerminal />)
    expect(await screen.findByText(SESSION.id)).toBeInTheDocument()
    expect(mocks.migrateTerminalOwner).not.toHaveBeenCalled()
    expect(mocks.closeBrowserPreview).not.toHaveBeenCalled()
    expect(useTerminalStore.getState().groups[DRAFT]?.tabs[0]?.panes[0]?.terminalId).toBe(
      draftTerminal,
    )
    expect(useTerminalStore.getState().groups[SESSION.id]?.tabs[0]?.panes[0]?.terminalId).toBe(
      sessionTerminal,
    )
    expect(useWorkspacePanelStore.getState().groups[DRAFT]?.browserTabs[0]?.id).toBe(
      draftPreview.previewId,
    )
    expect(useWorkspacePanelStore.getState().groups[SESSION.id]?.browserTabs[0]?.id).toBe(
      sessionPreview.previewId,
    )
  })

  it('migrates the exact born Session once after an authorized first-send creation', async () => {
    const draftTerminal = createTerminal(DRAFT)
    const view = render(<WorkspaceTerminal />)
    await authorizeCreation()
    mocks.context.activeSession = SESSION
    view.rerender(<WorkspaceTerminal />)
    await waitFor(() => expect(useTerminalStore.getState().groups[DRAFT]).toBeUndefined())
    expect(mocks.migrateTerminalOwner).toHaveBeenCalledExactlyOnceWith(DRAFT, SESSION.id)
    expect(useTerminalStore.getState().groups[SESSION.id]?.tabs[0]?.panes[0]?.terminalId).toBe(
      draftTerminal,
    )
  })

  it('preserves existing destination tabs even if a creation receipt is present', async () => {
    const draftTerminal = createTerminal(DRAFT)
    const destinationTerminal = createTerminal(SESSION.id)
    const view = render(<WorkspaceTerminal />)
    await authorizeCreation()
    mocks.context.activeSession = SESSION
    view.rerender(<WorkspaceTerminal />)
    expect(await screen.findByText(SESSION.id)).toBeInTheDocument()
    expect(mocks.migrateTerminalOwner).not.toHaveBeenCalled()
    expect(useTerminalStore.getState().groups[DRAFT]?.tabs[0]?.panes[0]?.terminalId).toBe(
      draftTerminal,
    )
    expect(useTerminalStore.getState().groups[SESSION.id]?.tabs[0]?.panes[0]?.terminalId).toBe(
      destinationTerminal,
    )
  })

  it('holds the draft through repeated owner effects in StrictMode until migration commits', async () => {
    createTerminal(DRAFT)
    const deferred = Promise.withResolvers<void>()
    mocks.migrateTerminalOwner.mockReturnValue(deferred.promise)
    const element = (
      <StrictMode>
        <WorkspaceTerminal />
      </StrictMode>
    )
    const view = render(element)
    await authorizeCreation()
    mocks.context.activeSession = SESSION
    view.rerender(
      <StrictMode>
        <WorkspaceTerminal />
      </StrictMode>,
    )
    await waitFor(() => expect(mocks.migrateTerminalOwner).toHaveBeenCalledTimes(1))
    mocks.context.activeSession = {
      ...SESSION,
      environmentMode: 'worktree',
      worktreePath: '/repo/tree',
    }
    view.rerender(
      <StrictMode>
        <WorkspaceTerminal />
      </StrictMode>,
    )
    expect(await screen.findByText(DRAFT)).toBeInTheDocument()
    expect(useTerminalStore.getState().groups[SESSION.id]).toBeUndefined()
    expect(mocks.migrateTerminalOwner).toHaveBeenCalledTimes(1)
    await act(async () => deferred.resolve())
    await waitFor(() => expect(useTerminalStore.getState().groups[DRAFT]).toBeUndefined())
    expect(await screen.findByText(SESSION.id)).toBeInTheDocument()
  })

  it('does not expose or replay failed draft migration as Session-owned tabs', async () => {
    createTerminal(DRAFT)
    mocks.migrateTerminalOwner.mockRejectedValue(new Error('Migration failed'))
    const view = render(<WorkspaceTerminal />)
    await authorizeCreation()
    mocks.context.activeSession = SESSION
    view.rerender(<WorkspaceTerminal />)
    await waitFor(() => expect(screen.queryByText(DRAFT)).not.toBeInTheDocument())
    expect(useTerminalStore.getState().groups[DRAFT]).toBeDefined()
    expect(useTerminalStore.getState().groups[SESSION.id]).toBeUndefined()
    expect(mocks.beginTerminalEventOwnerHandoff.mock.results[0]?.value).toHaveBeenCalledTimes(1)
    await act(async () => view.rerender(<WorkspaceTerminal />))
    expect(mocks.migrateTerminalOwner).toHaveBeenCalledTimes(1)
  })

  it('does not sweep new tabs when navigation returns to the draft during handoff', async () => {
    const originalTerminal = createTerminal(DRAFT)
    const deferred = Promise.withResolvers<void>()
    mocks.migrateTerminalOwner.mockReturnValue(deferred.promise)
    const view = render(<WorkspaceTerminal />)
    await authorizeCreation()
    mocks.context.activeSession = SESSION
    view.rerender(<WorkspaceTerminal />)
    await waitFor(() => expect(mocks.migrateTerminalOwner).toHaveBeenCalledTimes(1))
    useChatStore.getState().startDraftSession('/repo')
    mocks.context.activeSession = null
    view.rerender(<WorkspaceTerminal />)
    expect(useTerminalStore.getState().createTerminal(DRAFT, '/repo')).toBeNull()
    await act(async () => deferred.resolve())
    await waitFor(() => expect(useTerminalStore.getState().groups[DRAFT]).toBeUndefined())
    let newTerminal: string | null = null
    act(() => {
      newTerminal = createTerminal(DRAFT)
    })
    expect(newTerminal).not.toBeNull()
    expect(newTerminal).not.toBe(originalTerminal)
    expect(useTerminalStore.getState().groups[DRAFT]?.tabs[0]?.panes[0]?.terminalId).toBe(
      newTerminal,
    )
    expect(useTerminalStore.getState().groups[SESSION.id]?.tabs[0]?.panes[0]?.terminalId).toBe(
      originalTerminal,
    )
    expect(mocks.migrateTerminalOwner).toHaveBeenCalledTimes(1)
  })

  it.each([1, 2, 3, 'workspace'] as const)(
    'completes all owner transfers despite persistence failure at %s',
    async (seam) => {
      const baseTerminal = createTerminal(DRAFT)
      const sideTerminal = createTerminal(terminalSidePanelLayoutKey(DRAFT))
      rememberTerminalLayoutFocus(DRAFT, terminalSidePanelLayoutKey(DRAFT))
      const preview = useWorkspacePanelStore.getState().openBrowser(DRAFT, 'https://draft.test')
      useBrowserPreviewFloatingStore.getState().open(DRAFT, preview.previewId)
      const deferred = Promise.withResolvers<void>()
      mocks.migrateTerminalOwner.mockReturnValue(deferred.promise)
      const view = render(<WorkspaceTerminal />)
      await authorizeCreation()
      mocks.context.activeSession = SESSION
      view.rerender(<WorkspaceTerminal />)
      await waitFor(() => expect(mocks.migrateTerminalOwner).toHaveBeenCalledTimes(1))
      const releaseEvents = mocks.beginTerminalEventOwnerHandoff.mock.results[0]?.value
      expect(releaseEvents).toBeDefined()
      act(() => useTerminalStore.getState().ensureTerminal(DRAFT, 'deferred-setup', '/repo'))
      const storage =
        seam === 'workspace'
          ? useWorkspacePanelStore.persist.getOptions().storage
          : useTerminalStore.persist.getOptions().storage
      if (!storage) throw new Error('Expected terminal persistence storage')
      const failure = new Error('Terminal layout persistence failed')
      const originalWrite = storage.setItem.bind(storage)
      let writes = 0
      const persist = vi.spyOn(storage, 'setItem').mockImplementation((...args) => {
        writes += 1
        if (writes === (seam === 'workspace' ? 1 : seam)) throw failure
        return originalWrite(...args)
      })
      const frames: FrameRequestCallback[] = []
      const scheduleFrame = vi
        .spyOn(globalThis, 'requestAnimationFrame')
        .mockImplementation((frame) => {
          frames.push(frame)
          return frames.length
        })
      try {
        await act(async () => deferred.resolve())
        await waitFor(() => expect(useUIStore.getState().toastMessage).toBe(failure.message))
        const destinationIds = useTerminalStore
          .getState()
          .groups[SESSION.id]?.tabs.flatMap((tab) => tab.panes.map((pane) => pane.terminalId))
        expect(destinationIds).toContain('deferred-setup')
        expect(destinationIds).toContain(baseTerminal)
        expect(useTerminalStore.getState().groups[DRAFT]).toBeUndefined()
        expect(
          useTerminalStore.getState().groups[terminalSidePanelLayoutKey(DRAFT)],
        ).toBeUndefined()
        expect(
          useTerminalStore.getState().groups[terminalSidePanelLayoutKey(SESSION.id)]?.tabs[0]
            ?.panes[0]?.terminalId,
        ).toBe(sideTerminal)
        expect(useWorkspacePanelStore.getState().groups[DRAFT]).toBeUndefined()
        expect(useWorkspacePanelStore.getState().groups[SESSION.id]?.browserTabs[0]).toMatchObject({
          id: preview.previewId,
          ownerKey: SESSION.id,
        })
        expect(useBrowserPreviewFloatingStore.getState().byOwnerKey[DRAFT]).toBeUndefined()
        expect(useBrowserPreviewFloatingStore.getState().byOwnerKey[SESSION.id]?.previewId).toBe(
          preview.previewId,
        )
        expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
          kind: 'workspace',
          ownerKey: SESSION.id,
        })
        expect(
          resolveTerminalCommandLayoutOwner(SESSION.id, useTerminalStore.getState().groups),
        ).toBe(terminalSidePanelLayoutKey(SESSION.id))
        expect(unregisterBrowserPreviewOwner).toHaveBeenCalledWith(DRAFT)
        expect(isWorkspaceOwnerHandoffPending(DRAFT)).toBe(false)
        expect(isWorkspaceOwnerHandoffPending(SESSION.id)).toBe(false)
        expect(releaseEvents).not.toHaveBeenCalled()
        act(() => frames.shift()?.(0))
        expect(releaseEvents).not.toHaveBeenCalled()
        act(() => frames.shift()?.(0))
        expect(releaseEvents).toHaveBeenCalledTimes(1)
        expect(mocks.migrateTerminalOwner).toHaveBeenCalledTimes(1)
      } finally {
        persist.mockRestore()
        scheduleFrame.mockRestore()
      }
    },
  )
})
