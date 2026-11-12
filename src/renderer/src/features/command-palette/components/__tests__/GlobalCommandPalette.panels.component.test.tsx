import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { usePreferencesStore } from '@/features/settings/state'
import { registerRightPanelController } from '@/shared/lib/right-panel-surfaces'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { useUIStore } from '@/shell/ui-store'
import { COLD_IMPORT_TIMEOUT_MS } from '@/test-utils/cold-import'
import { installModalDialogStub } from '@/test-utils/modal-dialog'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { answerProjectActions, NOTES, sidePanelEntry } from './global-command-palette-fixtures'

/*
 * Only the preload and the router are replaced: the palette's action hooks, the project action
 * and terminal hooks, and the chat, preference, UI and Right sidebar stores are the real ones.
 * The open Session's project differs from the palette's (preference-backed) project: the
 * preference write that follows a Session switch can lag or fail.
 */
const SESSION_ID = SessionId('session-1')

const mocks = vi.hoisted(() => ({
  listExtensionContributions: vi.fn(),
  manageProjectActions: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', async () => ({
  api: (await import('@/test-utils/preload-api')).preloadApi({
    listExtensionContributions: mocks.listExtensionContributions,
    manageProjectActions: mocks.manageProjectActions,
  }),
}))
// The palette navigates the app route tree, which a component test does not build.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: '/' } }),
}))

async function renderPalette() {
  const { GlobalCommandPalette } = await import('../GlobalCommandPalette')
  renderWithQueryClient(<GlobalCommandPalette />)
  await screen.findByRole('option', { name: /Notes/ })
}

/** The built-in panels plus the one extension panel this test installs. */
const PANEL_COUNT = 10

function panelLabels() {
  const items = screen.getAllByRole('option')
  const first = items.findIndex((item) => within(item).queryByText('All panels') !== null)
  return items.slice(first, first + PANEL_COUNT).map((item) => item.textContent)
}

const initialChat = useChatStore.getInitialState()
const initialPreferences = usePreferencesStore.getInitialState()
const initialUI = useUIStore.getInitialState()
const initialCoordinator = useRightSidebarCoordinator.getInitialState()
const isClosed = () => useUIStore.getState().commandSurface === null

describe('GlobalCommandPalette Panels section', () => {
  const controller = {
    toggleSurface: vi.fn(),
    showSurface: vi.fn(),
    togglePanel: vi.fn(),
    closePanel: vi.fn(),
  }
  let unregister: (() => void) | null = null

  beforeAll(async () => {
    // The palette's module graph is large; load it once here instead of inside the first test.
    await import('../GlobalCommandPalette')
    installModalDialogStub()
    Element.prototype.scrollIntoView ??= function scrollIntoView() {}
  }, COLD_IMPORT_TIMEOUT_MS)

  beforeEach(() => {
    vi.clearAllMocks()
    usePreferencesStore.setState({
      settings: {
        ...DEFAULT_SETTINGS,
        projectPath: '/repo',
        extensionPanelShortcutBindings: { [NOTES]: { key: 'G', mod: true, shift: true } },
      },
    })
    useChatStore.setState({
      activeSessionId: SESSION_ID,
      activeSession: fromPartial<SessionDetail>({
        id: SESSION_ID,
        projectPath: '/session-project',
        messages: [],
      }),
    })
    useUIStore.setState({ commandSurface: 'commands' })
    mocks.listExtensionContributions.mockResolvedValue({
      projectPaths: ['/repo'],
      entries: [sidePanelEntry()],
    })
    mocks.manageProjectActions.mockImplementation(answerProjectActions)
  })

  afterEach(() => {
    unregister?.()
    unregister = null
    useChatStore.setState(initialChat, true)
    usePreferencesStore.setState(initialPreferences, true)
    useUIStore.setState(initialUI, true)
    useRightSidebarCoordinator.setState(initialCoordinator, true)
  })

  it('lists each surface once with its binding, extension panels under their extension name', async () => {
    await renderPalette()

    expect(screen.getByText('Panels')).toBeInTheDocument()
    expect(panelLabels()).toEqual([
      'All panelsEvery panel you can open here, with its shortcut',
      'ChangesReview the working tree diffCtrl + D',
      'Project ActionsRun, stop and inspect project actions',
      "ScheduledThis project's Heartbeats and Launch schedules",
      'BrowserPreview pages in the session browserCtrl + Shift + J',
      'FilesBrowse and edit workspace files',
      'Session TreeInspect branches and session historyCtrl + Shift + Y',
      'ResourcesSources and outputs captured in this session',
      'HiveMove across the Sessions of this Hive',
      // The leading N is the extension's letter-tile icon.
      'NNotesAcme NotesGlobalCtrl + Shift + G',
    ])
    // The surfaces moved into Panels are not repeated elsewhere.
    expect(screen.queryByText('Toggle diff panel')).not.toBeInTheDocument()
    expect(screen.queryByText('Open session tree')).not.toBeInTheDocument()
    expect(screen.queryByText('Writing')).not.toBeInTheDocument()
  })

  it("lists and runs project actions of the open Session's project, not the preference", async () => {
    await renderPalette()

    fireEvent.click(await screen.findByRole('option', { name: /^Serve app/ }))

    expect(isClosed()).toBe(true)
    await waitFor(() =>
      expect(mocks.manageProjectActions).toHaveBeenCalledWith({
        scope: { projectPath: '/session-project', sessionId: SESSION_ID },
        operation: expect.objectContaining({ type: 'start', actionId: 'serve' }),
      }),
    )
  })

  it('shows the chosen surface through the Right panel controller', async () => {
    unregister = registerRightPanelController(controller)
    await renderPalette()

    fireEvent.click(screen.getByRole('option', { name: /^Notes/ }))

    expect(isClosed()).toBe(true)
    expect(controller.showSurface).toHaveBeenCalledWith(NOTES)
    expect(controller.toggleSurface).not.toHaveBeenCalled()
  })

  it('runs the highlighted panel with Enter after filtering', async () => {
    unregister = registerRightPanelController(controller)
    await renderPalette()

    const search = screen.getByRole('combobox', { name: 'Search commands' })
    fireEvent.change(search, { target: { value: 'session tree' } })
    fireEvent.keyDown(search, { key: 'Enter' })

    await waitFor(() => expect(controller.showSurface).toHaveBeenCalledWith('session-tree'))
  })

  it('opens with the search focused and moves the highlight with the arrow keys', async () => {
    unregister = registerRightPanelController(controller)
    await renderPalette()

    const search = screen.getByRole('combobox', { name: 'Search commands' })
    await waitFor(() => expect(search).toHaveFocus())
    fireEvent.change(search, { target: { value: 'panels' } })
    const listbox = screen.getByRole('listbox', { name: 'Commands' })
    expect(search).toHaveAttribute('aria-controls', listbox.id)

    const options = within(listbox).getAllByRole('option')
    expect(search).toHaveAttribute('aria-activedescendant', options[0]?.id)
    expect(options[0]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(search).toHaveAttribute('aria-activedescendant', options[1]?.id)
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    fireEvent.keyDown(search, { key: 'ArrowUp' })
    // Wraps from the first option to the last.
    expect(search).toHaveAttribute('aria-activedescendant', options.at(-1)?.id)
    // Options stay out of the Tab order; focus remains in the search field.
    for (const option of options) expect(option).toHaveAttribute('tabindex', '-1')
  })

  it('points aria-activedescendant at the new top match while filtering', async () => {
    await renderPalette()
    const search = screen.getByRole('combobox', { name: 'Search commands' })

    fireEvent.change(search, { target: { value: 'changes' } })
    const changes = screen.getByRole('option', { name: /^Changes/ })
    expect(search).toHaveAttribute('aria-activedescendant', changes.id)

    fireEvent.change(search, { target: { value: 'notes' } })
    const notes = screen.getByRole('option', { name: /^Notes/ })
    expect(notes.id).not.toBe(changes.id)
    expect(search).toHaveAttribute('aria-activedescendant', notes.id)
  })

  it('closes on Escape from the search field', async () => {
    await renderPalette()

    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search commands' }), {
      key: 'Escape',
    })

    expect(isClosed()).toBe(true)
  })

  it('exposes each section as a named group of options', async () => {
    await renderPalette()

    const listbox = screen.getByRole('listbox', { name: 'Commands' })
    const panels = within(listbox).getByRole('group', { name: 'Panels' })
    expect(within(panels).getByRole('option', { name: /^Notes/ })).toBeInTheDocument()
  })

  it('announces when no command matches the query', async () => {
    await renderPalette()
    // A live region announces changes only once it is already in the accessibility tree.
    const status = screen.getByRole('status')
    expect(status).toBeEmptyDOMElement()

    fireEvent.change(screen.getByRole('combobox', { name: 'Search commands' }), {
      target: { value: 'zzz-no-such-command' },
    })

    expect(screen.getByRole('status')).toBe(status)
    expect(status).toHaveTextContent('No matching commands')
    expect(
      within(screen.getByRole('listbox', { name: 'Commands' })).queryAllByRole('option'),
    ).toEqual([])
    expect(screen.getByRole('combobox', { name: 'Search commands' })).not.toHaveAttribute(
      'aria-activedescendant',
    )
  })

  it('opens the legacy route panel while no controller is registered', async () => {
    await renderPalette()

    fireEvent.click(screen.getByRole('option', { name: /^Changes/ }))
    fireEvent.click(screen.getByRole('option', { name: /^Notes/ }))

    // Each opens through the open Session's route search, keeping the rest of it.
    const searches = mocks.navigate.mock.calls.map(([options]) => {
      expect(options).toMatchObject({
        to: '/sessions/$sessionId',
        params: { sessionId: 'session-1' },
      })
      return options.search({ keep: true })
    })
    expect(searches).toEqual([
      expect.objectContaining({ keep: true, panel: 'diff' }),
      expect.objectContaining({
        keep: true,
        panel: 'extension-side-panel',
        sidePanelExtensionId: 'acme.notes',
        sidePanelId: 'notes',
        sidePanelPackagePath: '/extensions/acme-notes',
        sidePanelContentHash: 'hash-1',
      }),
    ])
    expect(useUIStore.getState().lastRightSidebarPanel).toMatchObject({
      kind: 'extension-side-panel',
      extensionId: 'acme.notes',
      sidePanelId: 'notes',
    })
  })

  it('lists extension panels for the Session checkout the Panel rail asks about', async () => {
    const { GlobalCommandPalette } = await import('../GlobalCommandPalette')
    mocks.listExtensionContributions.mockImplementation(
      (input: { readonly projectPaths: readonly string[] }) =>
        Promise.resolve(
          input.projectPaths.includes('/repo/.worktrees/session-1')
            ? { projectPaths: input.projectPaths, entries: [sidePanelEntry()] }
            : { projectPaths: input.projectPaths, entries: [] },
        ),
    )
    renderWithQueryClient(<GlobalCommandPalette panelProjectPath="/repo/.worktrees/session-1" />)

    expect(await screen.findByRole('option', { name: /Notes/ })).toBeInTheDocument()
    expect(mocks.listExtensionContributions).toHaveBeenCalledWith(
      expect.objectContaining({ projectPaths: ['/repo/.worktrees/session-1'] }),
    )
  })
})
