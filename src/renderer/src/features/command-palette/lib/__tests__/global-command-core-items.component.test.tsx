import { SessionId } from '@shared/types/brand'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { formatShortcutBinding } from '@/shared/lib/shortcut-display'
import {
  type CoreCommandActions,
  createCoreCommandItems,
  createRecentProjectItems,
  createRecentSessionItems,
} from '../global-command-core-items'

const loggerWarn = vi.hoisted(() => vi.fn())
vi.mock('@/shared/lib/logger', () => ({
  createRendererLogger: () => ({ warn: loggerWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

function actions(overrides: Partial<CoreCommandActions> = {}) {
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
    ...overrides,
  } satisfies CoreCommandActions
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

  it('settles a failed recent-project open instead of floating its rejection', async () => {
    // The palette fires setProjectPath with `void`, so a transient Settings IPC failure used
    // to surface as an unhandled renderer rejection (Sentry issue OPENWAGGLE-6).
    const commandActions = actions({
      setProjectPath: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:443')),
    })
    const settings = { ...DEFAULT_SETTINGS, recentProjects: ['/other-project'] }
    const item = createRecentProjectItems(settings, [], commandActions).find(
      (entry) => entry.id === 'project:/other-project',
    )

    item?.action()

    await waitFor(() =>
      expect(loggerWarn).toHaveBeenCalledWith('Failed to open the recent project', {
        error: expect.stringContaining('ECONNREFUSED'),
      }),
    )
    // The Session is neither routed nor started, so nothing else runs.
    expect(commandActions.routeToSession).not.toHaveBeenCalled()
    expect(commandActions.newSession).not.toHaveBeenCalled()
  })
})
