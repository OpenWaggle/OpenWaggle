import { describe, expect, it, vi } from 'vitest'
import type { CommandPaletteItem } from '../../model'
import { buildCommandPaletteEntries } from '../command-palette-entries'
import { createBuiltInCommandItems, createSkillItems } from '../command-palette-items'
import { normalizeCommandQuery, truncateCommandDescription } from '../command-palette-text'

const {
  closeSlashCommandMenuMock,
  consumeActiveSlashCommandMock,
  getUiStateMock,
  insertSlashCommandTextAtActiveSlashMock,
  openFeedbackModalMock,
} = vi.hoisted(() => ({
  closeSlashCommandMenuMock: vi.fn(),
  consumeActiveSlashCommandMock: vi.fn(),
  getUiStateMock: vi.fn(),
  insertSlashCommandTextAtActiveSlashMock: vi.fn(),
  openFeedbackModalMock: vi.fn(),
}))

vi.mock('@/features/composer/lib', () => ({
  consumeActiveSlashCommand: consumeActiveSlashCommandMock,
  insertSlashCommandTextAtActiveSlash: insertSlashCommandTextAtActiveSlashMock,
}))

vi.mock('@/shell/ui-store', () => ({
  useUIStore: { getState: getUiStateMock },
}))

const { createOptionalCommandPaletteAction, openFeedbackModal } = await import(
  '../command-palette-actions'
)

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

describe('createBuiltInCommandItems', () => {
  it('lists the GUI-only built-in commands for an empty query', () => {
    const items = createBuiltInCommandItems('', vi.fn())

    expect(items.map((command) => command.trailing)).toEqual(['/compact', '/fork', '/clone'])
    expect(items.every((command) => command.section === 'Commands')).toBe(true)
    expect(items.some((command) => command.submitsOnEnter)).toBe(false)
  })

  it('completes a partially typed command so instructions can follow it', () => {
    const insertCommand = vi.fn()
    const items = createBuiltInCommandItems('comp', insertCommand)

    expect(items.map((command) => command.id)).toEqual(['command-compact'])
    expect(items[0]?.submitsOnEnter).toBe(false)
    items[0]?.action()
    expect(insertCommand).toHaveBeenCalledWith('/compact')
  })

  it('submits a fully typed command on Enter instead of completing it', () => {
    const items = createBuiltInCommandItems('compact', vi.fn())

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'command-compact', submitsOnEnter: true })
  })

  it('matches command names only, so short queries still reach skills', () => {
    expect(createBuiltInCommandItems('visualize', vi.fn())).toEqual([])
    expect(createBuiltInCommandItems('se', vi.fn())).toEqual([])
    expect(createBuiltInCommandItems('c', vi.fn()).map((command) => command.trailing)).toEqual([
      '/compact',
      '/clone',
    ])
  })
})

describe('createSkillItems', () => {
  it('always exposes the bundled Visualize skill through /visualize discovery', () => {
    const selectSkill = vi.fn()

    const items = createSkillItems([], 'visualize', selectSkill)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'skill-visualize',
      label: 'Visualize',
      section: 'Skills',
      trailing: '/visualize',
    })

    items[0]?.action()
    expect(selectSkill).toHaveBeenCalledWith('visualize', 'Visualize')
  })

  it('shows a disabled diagnostic instead of selecting an unavailable bundled skill', () => {
    const selectSkill = vi.fn()
    const items = createSkillItems(
      [
        {
          id: 'visualize',
          name: 'Visualize',
          description: 'Built-in visualization authoring is unavailable',
          folderPath: '/agent/visualize',
          skillPath: '/agent/visualize/SKILL.md',
          hasScripts: true,
          enabled: false,
          loadStatus: 'error',
          loadError: 'Read-only agent directory',
        },
      ],
      'visualize',
      selectSkill,
    )

    expect(items[0]).toMatchObject({
      id: 'skill-visualize',
      disabled: true,
      description: 'Unavailable: Read-only agent directory',
    })
    items[0]?.action()
    expect(selectSkill).not.toHaveBeenCalled()
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
