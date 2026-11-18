import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { act, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
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
import { useUIStore } from '../ui-store'
import { WorkspaceTerminal } from '../WorkspaceTerminal'
import { useWorkspacePanelStore } from '../workspace-panel-store'
import { resetWorkspaceShellStores } from './workspace-shell.test-harness'

/*
 * Only the preload and the xterm terminal panel are replaced: the chat, terminal, panel and
 * browser stores and the owner migration are the real ones.
 */
const eventHandoffs = vi.hoisted(() => new Array<Mock<() => void>>())
const mocks = vi.hoisted(() => ({
  createSession: vi.fn<() => Promise<SessionDetail>>(),
  getSessionDetail: vi.fn<() => Promise<SessionDetail | null>>(),
  migrateTerminalOwner: vi.fn<(_from: string, _to: string) => Promise<void>>(),
  closeBrowserPreview: vi.fn(async (_id: string) => undefined),
  unregisterBrowserPreviewOwner: vi.fn(async (_ownerKey: string) => undefined),
}))
vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi({
    ...mocks,
    getSessionTree: async () => null,
    registerBrowserPreviewOwner: async () => undefined,
  }),
}))
// The real event handoff, observed: the xterm panes that read it are replaced below.
vi.mock('@/features/terminal', async (importOriginal) => {
  const terminal = await importOriginal<typeof import('@/features/terminal')>()
  return {
    ...terminal,
    beginTerminalEventOwnerHandoff: (previousOwnerKey: string, nextOwnerKey: string) => {
      const release = vi.fn(terminal.beginTerminalEventOwnerHandoff(previousOwnerKey, nextOwnerKey))
      eventHandoffs.push(release)
      return release
    },
  }
})
// xterm needs a canvas jsdom lacks; the panel shows which owner it would render.
vi.mock('@/features/terminal/components', () => ({
  TerminalPanel: ({ ownerKey }: { readonly ownerKey: string }) => <section>{ownerKey}</section>,
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

const firstTerminal = (ownerKey: string) =>
  useTerminalStore.getState().groups[ownerKey]?.tabs[0]?.panes[0]?.terminalId

/** The first send creates the draft's Session, which is what authorizes moving its tabs. */
async function createSessionFromDraft() {
  await act(async () => {
    await useChatStore.getState().createSession('/repo')
  })
}

/** Selecting an existing Session, as the sidebar does; no creation receipt is issued. */
function openExistingSession() {
  act(() => {
    useChatStore.getState().upsertSession(SESSION)
    useChatStore.getState().setActiveSession(SESSION.id)
  })
}

/** Terminal events the Session emits still reach panes subscribed under the draft. */
const eventsHandedOff = () => eventHandoffs.some((release) => release.mock.calls.length === 0)

function resetStores() {
  resetWorkspaceShellStores()
  useBrowserPreviewFloatingStore.setState({ byOwnerKey: {} })
  useChatStore.getState().startDraftSession('/repo')
}

describe('WorkspaceTerminal draft materialization authority', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.migrateTerminalOwner.mockReset().mockResolvedValue(undefined)
    mocks.createSession.mockResolvedValue(SESSION)
    mocks.getSessionDetail.mockResolvedValue(SESSION)
    eventHandoffs.length = 0
    resetStores()
  })
  afterEach(async () => {
    // A committed migration keeps routing draft events for two frames; let it end in its case.
    await waitFor(() => expect(eventsHandedOff()).toBe(false))
    resetStores()
  })

  it('keeps both owners intact when navigating from a draft to an existing Session', async () => {
    const draftTerminal = createTerminal(DRAFT)
    const sessionTerminal = createTerminal(SESSION.id)
    const draftPreview = useWorkspacePanelStore.getState().openBrowser(DRAFT, 'https://draft.test')
    const sessionPreview = useWorkspacePanelStore
      .getState()
      .openBrowser(SESSION.id, 'https://session.test')
    render(<WorkspaceTerminal />)
    openExistingSession()
    expect(await screen.findByText(SESSION.id)).toBeInTheDocument()
    expect(mocks.migrateTerminalOwner).not.toHaveBeenCalled()
    expect(mocks.closeBrowserPreview).not.toHaveBeenCalled()
    expect(firstTerminal(DRAFT)).toBe(draftTerminal)
    expect(firstTerminal(SESSION.id)).toBe(sessionTerminal)
    expect(useWorkspacePanelStore.getState().groups[DRAFT]?.browserTabs[0]?.id).toBe(
      draftPreview.previewId,
    )
    expect(useWorkspacePanelStore.getState().groups[SESSION.id]?.browserTabs[0]?.id).toBe(
      sessionPreview.previewId,
    )
  })

  it('migrates the exact born Session once after an authorized first-send creation', async () => {
    const draftTerminal = createTerminal(DRAFT)
    render(<WorkspaceTerminal />)
    await createSessionFromDraft()
    await waitFor(() => expect(useTerminalStore.getState().groups[DRAFT]).toBeUndefined())
    expect(mocks.migrateTerminalOwner).toHaveBeenCalledExactlyOnceWith(DRAFT, SESSION.id)
    expect(firstTerminal(SESSION.id)).toBe(draftTerminal)
  })

  it('preserves existing destination tabs even if a creation receipt is present', async () => {
    const draftTerminal = createTerminal(DRAFT)
    const destinationTerminal = createTerminal(SESSION.id)
    render(<WorkspaceTerminal />)
    await createSessionFromDraft()
    expect(await screen.findByText(SESSION.id)).toBeInTheDocument()
    await waitFor(() =>
      expect(useUIStore.getState().toastMessage).toBe(
        'The Session already has workspace tabs. Draft tabs were kept in the draft.',
      ),
    )
    expect(mocks.migrateTerminalOwner).not.toHaveBeenCalled()
    expect(firstTerminal(DRAFT)).toBe(draftTerminal)
    expect(firstTerminal(SESSION.id)).toBe(destinationTerminal)
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
    render(element)
    await createSessionFromDraft()
    await waitFor(() => expect(mocks.migrateTerminalOwner).toHaveBeenCalledTimes(1))
    // The Session's worktree lands while its tabs are still moving: a new owner effect runs.
    act(() =>
      useChatStore.setState({
        activeSession: { ...SESSION, environmentMode: 'worktree', worktreePath: '/repo/tree' },
      }),
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
    const migration = Promise.withResolvers<void>()
    mocks.migrateTerminalOwner.mockReturnValue(migration.promise)
    const view = render(<WorkspaceTerminal />)
    await createSessionFromDraft()
    await waitFor(() => expect(eventsHandedOff()).toBe(true))
    await act(async () => migration.reject(new Error('Migration failed')))
    await waitFor(() => expect(screen.queryByText(DRAFT)).not.toBeInTheDocument())
    expect(useUIStore.getState().toastMessage).toBe('Migration failed')
    expect(useTerminalStore.getState().groups[DRAFT]).toBeDefined()
    expect(useTerminalStore.getState().groups[SESSION.id]).toBeUndefined()
    expect(eventsHandedOff()).toBe(false)
    await act(async () => view.rerender(<WorkspaceTerminal />))
    expect(mocks.migrateTerminalOwner).toHaveBeenCalledTimes(1)
  })

  it('does not sweep new tabs when navigation returns to the draft during handoff', async () => {
    const originalTerminal = createTerminal(DRAFT)
    const deferred = Promise.withResolvers<void>()
    mocks.migrateTerminalOwner.mockReturnValue(deferred.promise)
    render(<WorkspaceTerminal />)
    await createSessionFromDraft()
    await waitFor(() => expect(mocks.migrateTerminalOwner).toHaveBeenCalledTimes(1))
    act(() => useChatStore.getState().startDraftSession('/repo'))
    expect(useTerminalStore.getState().createTerminal(DRAFT, '/repo')).toBeNull()
    await act(async () => deferred.resolve())
    await waitFor(() => expect(useTerminalStore.getState().groups[DRAFT]).toBeUndefined())
    let newTerminal: string | null = null
    act(() => {
      newTerminal = createTerminal(DRAFT)
    })
    expect(newTerminal).not.toBeNull()
    expect(newTerminal).not.toBe(originalTerminal)
    expect(firstTerminal(DRAFT)).toBe(newTerminal)
    expect(firstTerminal(SESSION.id)).toBe(originalTerminal)
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
      render(<WorkspaceTerminal />)
      await createSessionFromDraft()
      await waitFor(() => expect(mocks.migrateTerminalOwner).toHaveBeenCalledTimes(1))
      expect(eventsHandedOff()).toBe(true)
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
        expect(mocks.unregisterBrowserPreviewOwner).toHaveBeenCalledWith(DRAFT)
        expect(isWorkspaceOwnerHandoffPending(DRAFT)).toBe(false)
        expect(isWorkspaceOwnerHandoffPending(SESSION.id)).toBe(false)
        // Late draft-owned terminal events keep reaching the moved panes for two frames.
        expect(eventsHandedOff()).toBe(true)
        act(() => frames.shift()?.(0))
        expect(eventsHandedOff()).toBe(true)
        act(() => frames.shift()?.(0))
        expect(eventsHandedOff()).toBe(false)
        expect(mocks.migrateTerminalOwner).toHaveBeenCalledTimes(1)
      } finally {
        persist.mockRestore()
        scheduleFrame.mockRestore()
      }
    },
  )
})
