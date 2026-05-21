import { describe, expect, it, vi } from 'vitest'
import type { CommandPaletteItem } from '../../model'
import { buildCommandPaletteEntries } from '../command-palette-entries'
import { createBaseCommands } from '../command-palette-items'
import { normalizeCommandQuery, truncateCommandDescription } from '../command-palette-text'

const {
  closeCommandPaletteMock,
  compactCommandTextMock,
  focusEditorMock,
  getComposerStateMock,
  getUiStateMock,
  openFeedbackModalMock,
  setCursorIndexMock,
  setEditorTextMock,
  setInputMock,
} = vi.hoisted(() => ({
  closeCommandPaletteMock: vi.fn(),
  compactCommandTextMock: vi.fn(() => '/compact'),
  focusEditorMock: vi.fn(),
  getComposerStateMock: vi.fn(),
  getUiStateMock: vi.fn(),
  openFeedbackModalMock: vi.fn(),
  setCursorIndexMock: vi.fn(),
  setEditorTextMock: vi.fn(),
  setInputMock: vi.fn(),
}))

vi.mock('@/features/composer/commands', () => ({
  compactCommandText: compactCommandTextMock,
}))

vi.mock('@/features/composer/lib', () => ({
  setEditorText: setEditorTextMock,
}))

vi.mock('@/features/composer/state', () => ({
  useComposerStore: { getState: getComposerStateMock },
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
    const closeCommandPalette = vi.fn()
    const commands = createBaseCommands({
      closeCommandPalette,
      configureWaggle: vi.fn(),
      insertCompactCommand: vi.fn(),
      selectPreset: vi.fn(),
      selectSkill: vi.fn(),
      startWaggle: vi.fn(),
    })

    expect(commands.map((command) => command.id)).not.toContain('code-review')
    expect(commands.map((command) => command.id)).not.toContain('new-worktree')
    expect(commands.map((command) => command.id)).not.toContain('personality')
    expect(commands.some((command) => command.action === closeCommandPalette)).toBe(false)
  })
})

describe('command palette actions', () => {
  it('wraps optional actions by closing the palette before running the action', () => {
    const close = vi.fn()
    const action = vi.fn()

    createOptionalCommandPaletteAction(close, action)?.()

    expect(close).toHaveBeenCalledBefore(action)
  })

  it('returns undefined when an optional action is unavailable', () => {
    expect(createOptionalCommandPaletteAction(vi.fn())).toBeUndefined()
  })

  it('inserts the compact command into plain composer state when no editor is mounted', () => {
    getComposerStateMock.mockReturnValue({
      lexicalEditor: null,
      setCursorIndex: setCursorIndexMock,
      setInput: setInputMock,
    })

    insertCompactCommand()

    expect(setInputMock).toHaveBeenCalledWith('/compact ')
    expect(setCursorIndexMock).toHaveBeenCalledWith('/compact '.length)
    expect(setEditorTextMock).not.toHaveBeenCalled()
  })

  it('inserts the compact command into Lexical and focuses the editor when mounted', () => {
    getComposerStateMock.mockReturnValue({
      lexicalEditor: { focus: focusEditorMock },
      setCursorIndex: setCursorIndexMock,
      setInput: setInputMock,
    })

    insertCompactCommand()

    expect(setEditorTextMock).toHaveBeenCalledWith({ focus: focusEditorMock }, '/compact ')
    expect(focusEditorMock).toHaveBeenCalled()
  })

  it('opens feedback through shell state after closing the command palette', () => {
    getUiStateMock.mockReturnValue({
      closeCommandPalette: closeCommandPaletteMock,
      openFeedbackModal: openFeedbackModalMock,
    })

    openFeedbackModal()

    expect(closeCommandPaletteMock).toHaveBeenCalledBefore(openFeedbackModalMock)
  })
})
