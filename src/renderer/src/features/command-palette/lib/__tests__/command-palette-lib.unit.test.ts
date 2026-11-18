import type { SkillDiscoveryItem } from '@shared/types/standards'
import { describe, expect, it, vi } from 'vitest'
import { buildCommandPaletteEntries } from '../command-palette-entries'
import {
  createBuiltInCommandItems,
  createSkillItems,
  skillOwnedCommandNames,
} from '../command-palette-items'
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

const { createOptionalCommandPaletteAction, openFeedbackModal } =
  await import('../command-palette-actions')

function item(id: string, section?: string) {
  return {
    id,
    label: id,
    icon: id,
    ...(section === undefined ? {} : { section }),
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
  const discoveryItem = (id: string, name: string, description: string) => {
    const item: SkillDiscoveryItem = {
      id,
      name,
      description,
      folderPath: `/project/.agents/skills/${id}`,
      skillPath: `/project/.agents/skills/${id}/SKILL.md`,
      hasScripts: false,
      enabled: true,
      loadStatus: 'ok',
    }
    return item
  }

  it('always exposes the bundled Visualize skill through /visualize discovery', () => {
    const selectSkill = vi.fn()

    const items = createSkillItems([], 'visualize', selectSkill)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: 'skill-visualize',
      label: 'Visualize',
      section: 'Skills',
      trailing: '/skill:visualize',
    })

    items[0]?.action()
    expect(selectSkill).toHaveBeenCalledWith('visualize', 'Visualize')
  })

  it('invokes a project skill by the name Pi resolves, not by its folder id', () => {
    const selectSkill = vi.fn()

    const items = createSkillItems(
      [
        {
          id: 'handoff-folder',
          name: 'handoff',
          description: 'Compact the current conversation into a handoff document',
          folderPath: '/project/.agents/skills/handoff-folder',
          skillPath: '/project/.agents/skills/handoff-folder/SKILL.md',
          hasScripts: false,
          enabled: true,
          loadStatus: 'ok',
        },
      ],
      '',
      selectSkill,
    )

    items.find((item) => item.id === 'skill-handoff-folder')?.action()
    expect(selectSkill).toHaveBeenCalledWith('handoff', 'handoff')
  })

  it('ranks a fully typed skill name ahead of every weaker match, in tier order', () => {
    // Guards the /pr regression: skills discovered earlier matched the query through their
    // descriptions ("PR", "pull request") and buried the exact-name skill the user typed.
    const items = createSkillItems(
      [
        discoveryItem('babysit', 'babysit', 'Watch a GitHub PR until its checks are green'),
        discoveryItem('brew-pr-guide', 'brew', 'Brew coffee well'),
        discoveryItem('depressurize', 'depressurize', 'Lower the pressure'),
        discoveryItem('prompt-tool', 'prompt tool', 'Reusable prompt library'),
        discoveryItem('ready', 'ready', 'Mark a PR ready for review'),
        discoveryItem('pr', 'pr', 'Prepare and open a draft GitHub pull request'),
      ],
      'pr',
      vi.fn(),
    )

    expect(items.map((item) => item.label)).toEqual([
      'pr', // exact name
      'prompt tool', // name prefix
      'depressurize', // name substring
      'brew', // folder id
      'babysit', // description, discovery order kept within the tier
      'ready',
    ])
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

describe('skillOwnedCommandNames', () => {
  const skillBase: SkillDiscoveryItem = {
    id: 'handoff',
    name: 'handoff',
    description: 'Compact the current conversation into a handoff document',
    folderPath: '/project/.agents/skills/handoff',
    skillPath: '/project/.agents/skills/handoff/SKILL.md',
    hasScripts: false,
    enabled: true,
    loadStatus: 'ok',
  }
  const skill = (overrides: Partial<SkillDiscoveryItem> = {}) => ({ ...skillBase, ...overrides })

  it('claims the name an enabled skill is offered under, not the folder it lives in', () => {
    // The two tokens differ: Pi matches a skill by its frontmatter name alone, so a Pi command
    // named after the folder still runs and keeps its row.
    const names = skillOwnedCommandNames([
      skill({ id: 'handoff-folder', name: 'handoff' }),
      skill({ id: 'qa', name: 'qa' }),
    ])

    expect([...names].sort()).toEqual(['handoff', 'qa'])
  })

  it('leaves the name of a disabled or broken skill to the Pi extension command', () => {
    const names = skillOwnedCommandNames([
      skill({ enabled: false }),
      skill({ id: 'broken', name: 'broken', loadStatus: 'error' }),
    ])

    expect([...names]).toEqual([])
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
