import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { describe, expect, it, vi } from 'vitest'
import { type CoreCommandActions, createCoreCommandItems } from '../global-command-core-items'

function actions(): CoreCommandActions {
  return {
    compactSession: vi.fn().mockResolvedValue(undefined),
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

  it('offers Session Summary as a view command', () => {
    const commandActions = actions()
    const toggle = createCoreCommandItems('/repo', DEFAULT_SETTINGS, commandActions).find(
      (item) => item.id === 'toggle-session-summary',
    )

    expect(toggle?.label).toBe('Toggle Session Summary')
    toggle?.action()
    expect(commandActions.toggleSessionSummary).toHaveBeenCalledOnce()
  })
})
