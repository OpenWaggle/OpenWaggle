import { SessionId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { describe, expect, it, vi } from 'vitest'
import { formatShortcutBinding } from '@/shared/lib/shortcut-display'
import {
  type CoreCommandActions,
  createCoreCommandItems,
  createRecentSessionItems,
} from '../global-command-core-items'

function actions(): CoreCommandActions {
  return {
    compactSession: vi.fn().mockResolvedValue(undefined),
    copySessionLink: vi.fn(),
    finish: (action) => action(),
    navigateTo: vi.fn(),
    newSession: vi.fn(),
    openBuiltInPanel: vi.fn(),
    openCommandSurface: vi.fn(),
    openFeedbackModal: vi.fn(),
    requestSessionCommand: vi.fn(),
    routeToSession: vi.fn(),
    selectProject: vi.fn().mockResolvedValue(undefined),
    setProjectPath: vi.fn().mockResolvedValue(undefined),
    toggleSidebar: vi.fn(),
    toggleSessionSummary: vi.fn(),
    toggleTerminal: vi.fn(),
    newTerminal: vi.fn(),
    newSideTerminal: vi.fn(),
    splitTerminal: vi.fn(),
    splitTerminalVertical: vi.fn(),
    toggleSidePanelMaximized: vi.fn(),
    closeActiveTerminal: vi.fn(async () => undefined),
  }
}

describe('global command core items', () => {
  it('offers compaction as a global application action', () => {
    const commandActions = actions()
    const compact = createCoreCommandItems('/repo', DEFAULT_SETTINGS, commandActions).find(
      (item) => item.id === 'compact-session',
    )

    expect(compact?.label).toBe('Compact session')
    compact?.action()
    expect(commandActions.compactSession).toHaveBeenCalledOnce()
  })

  it('offers the open Session link with its shortcut, and nothing without a Session', () => {
    const commandActions = actions()
    const copy = createCoreCommandItems('/repo', DEFAULT_SETTINGS, commandActions, {
      sessionId: 'session-1',
      openablePanelIds: new Set(),
    }).find((item) => item.id === 'copy-session-link')

    expect(copy?.label).toBe('Copy session link')
    expect(copy?.trailing).toBe(
      formatShortcutBinding(DEFAULT_SETTINGS.shortcutBindings['session.copyLink']),
    )
    expect(copy?.trailing).not.toBe('')
    copy?.action()
    expect(commandActions.copySessionLink).toHaveBeenCalledWith('session-1')
    expect(
      createCoreCommandItems('/repo', DEFAULT_SETTINGS, commandActions, {
        sessionId: null,
        openablePanelIds: new Set(),
      }).some((item) => item.id === 'copy-session-link'),
    ).toBe(false)
  })

  it('shows Copy session link as unassigned only while an openable panel takes its chord', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      extensionPanelShortcutBindings: {
        'extension:acme:notes': { key: 'L', mod: true, alt: true },
      },
    }
    const hint = (openablePanelIds: ReadonlySet<string>) =>
      createCoreCommandItems('/repo', settings, actions(), {
        sessionId: 'session-1',
        openablePanelIds,
      }).find((item) => item.id === 'copy-session-link')?.trailing

    expect(hint(new Set(['extension:acme:notes']))).toBe(formatShortcutBinding(null))
    // The panel cannot open in this project, so the chord still copies the link.
    expect(hint(new Set())).toBe(
      formatShortcutBinding(DEFAULT_SETTINGS.shortcutBindings['session.copyLink']),
    )
  })

  it('offers Session Summary as a view command', () => {
    const commandActions = actions()
    const toggle = createCoreCommandItems('/repo', DEFAULT_SETTINGS, commandActions).find(
      (item) => item.id === 'toggle-session-summary',
    )

    expect(toggle?.label).toBe('Toggle Session Summary')
    toggle?.action()
    expect(commandActions.toggleSessionSummary).toHaveBeenCalledOnce()
  })

  it('offers side-panel terminal creation and maximize routes without an existing terminal', () => {
    const commandActions = actions()
    const items = createCoreCommandItems('/repo', DEFAULT_SETTINGS, commandActions)

    items.find((item) => item.id === 'new-side-terminal')?.action()
    items.find((item) => item.id === 'toggle-side-panel-maximized')?.action()

    expect(commandActions.newSideTerminal).toHaveBeenCalledOnce()
    expect(commandActions.toggleSidePanelMaximized).toHaveBeenCalledOnce()
  })

  it('shows running-terminal status on the matching recent session only', () => {
    const commandActions = actions()
    const items = createRecentSessionItems(
      [
        {
          id: SessionId('session-running'),
          title: 'Dev server',
          projectPath: '/repo',
          createdAt: 1,
          updatedAt: 2,
        },
        {
          id: SessionId('session-idle'),
          title: 'Idle task',
          projectPath: '/repo',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      commandActions,
      new Map([['session-running', 2]]),
    )

    expect(items.find((item) => item.id === 'session:session-running')?.trailingBadge).toBe(
      '2 terminals running',
    )
    expect(items.find((item) => item.id === 'session:session-idle')?.trailingBadge).toBeUndefined()
  })
})
