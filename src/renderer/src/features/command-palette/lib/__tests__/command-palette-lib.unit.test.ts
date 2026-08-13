import { describe, expect, it, vi } from 'vitest'
import type { CommandPaletteItem } from '../../model'
import { buildCommandPaletteEntries } from '../command-palette-entries'
import { createBaseCommands } from '../command-palette-items'
import { normalizeCommandQuery, truncateCommandDescription } from '../command-palette-text'

const {
  closeSlashCommandMenuMock,
  compactCommandTextMock,
  consumeActiveSlashCommandMock,
  getUiStateMock,
  insertSlashCommandTextAtActiveSlashMock,
  openFeedbackModalMock,
} = vi.hoisted(() => ({
  closeSlashCommandMenuMock: vi.fn(),
  compactCommandTextMock: vi.fn(() => '/compact'),
  consumeActiveSlashCommandMock: vi.fn(),
  getUiStateMock: vi.fn(),
  insertSlashCommandTextAtActiveSlashMock: vi.fn(),
  openFeedbackModalMock: vi.fn(),
}))

vi.mock('@/features/composer/commands', () => ({
  compactCommandText: compactCommandTextMock,
}))

vi.mock('@/features/composer/lib', () => ({
  consumeActiveSlashCommand: consumeActiveSlashCommandMock,
  insertSlashCommandTextAtActiveSlash: insertSlashCommandTextAtActiveSlashMock,
}))

vi.mock('@/shell/ui-store', () => ({
  useUIStore: { getState: getUiStateMock },
}))

const { createOptionalCommandPaletteAction, insertCompactCommand, openFeedbackModal } =
  await import('../command-palette-actions')

function item(id: string, section?: string): CommandPaletteItem {
  return {
    id,
    label: id,
    icon: id,
    section,
    action: vi.fn(),
  }
}

describe('command palette text helpers', () => {
  it('normalizes command queries for matching', () => {
    expect(normalizeCommandQuery('  Open SETTINGS  ')).toBe('open settings')
  })

  it('truncates descriptions only when they exceed the maximum length', () => {
    expect(truncateCommandDescription('abcdef', 3)).toBe('abc...')
    expect(truncateCommandDescription('abc', 3)).toBe('abc')
  })
})

describe('buildCommandPaletteEntries', () => {
  it('adds section headers and configure separators without duplicating adjacent sections', () => {
    const entries = buildCommandPaletteEntries([
      item('open-chat', 'navigation'),
      item('open-settings', 'navigation'),
      item('configure-waggle', 'configure'),
      item('start-waggle', 'waggle'),
    ])

    expect(entries.map((entry) => entry.type)).toEqual([
      'section',
      'item',
      'item',
      'separator',
      'item',
      'section',
      'item',
    ])
    expect(entries.map((entry) => entry.key)).toEqual([
      'section-navigation-0',
      'open-chat',
      'open-settings',
      'separator-2',
      'configure-waggle',
      'section-waggle-3',
      'start-waggle',
    ])
  })
})

describe('createBaseCommands', () => {
  it('does not expose commands that only close the palette without backing behavior', () => {
    const closeSlashCommandMenu = vi.fn()
    const commands = createBaseCommands({
      closeSlashCommandMenu,
      configureWaggle: vi.fn(),
      insertCompactCommand: vi.fn(),
      selectPreset: vi.fn(),
      selectSkill: vi.fn(),
      startWaggle: vi.fn(),
    })

    expect(commands.map((command) => command.id)).not.toContain('code-review')
    expect(commands.map((command) => command.id)).not.toContain('new-worktree')
    expect(commands.map((command) => command.id)).not.toContain('personality')
    expect(commands.some((command) => command.action === closeSlashCommandMenu)).toBe(false)
  })
})

describe('command palette actions', () => {
  it('wraps optional actions by consuming the slash token and closing the menu', () => {
    const close = vi.fn()
    const action = vi.fn()

    createOptionalCommandPaletteAction(close, action)?.()

    expect(consumeActiveSlashCommandMock).toHaveBeenCalledBefore(close)
    expect(close).toHaveBeenCalledBefore(action)
  })

  it('returns undefined when an optional action is unavailable', () => {
    expect(createOptionalCommandPaletteAction(vi.fn())).toBeUndefined()
  })

  it('replaces the active slash token with the compact command', () => {
    insertCompactCommand()

    expect(insertSlashCommandTextAtActiveSlashMock).toHaveBeenCalledWith('/compact')
  })

  it('opens feedback after consuming the slash token and closing the menu', () => {
    getUiStateMock.mockReturnValue({
      closeSlashCommandMenu: closeSlashCommandMenuMock,
      openFeedbackModal: openFeedbackModalMock,
    })

    openFeedbackModal()

    expect(consumeActiveSlashCommandMock).toHaveBeenCalledBefore(closeSlashCommandMenuMock)
    expect(closeSlashCommandMenuMock).toHaveBeenCalledBefore(openFeedbackModalMock)
  })
})
