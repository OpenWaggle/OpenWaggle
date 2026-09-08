import type { ProjectAction } from '@shared/types/project-actions'
import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { DEFAULT_SHORTCUT_RULES, shortcutBindingsFromRules } from '@shared/types/shortcuts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}))
const projectMocks = vi.hoisted(() => {
  const actions: ProjectAction[] = []
  return { actions, update: vi.fn() }
})

vi.mock('@/shared/lib/ipc', () => ({ api: apiMock }))
vi.mock('@/features/project-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/project-actions')>()
  return {
    ...actual,
    useProjectActions: () => ({ data: projectMocks.actions, isError: false }),
    useProjectActionMutations: () => ({
      update: projectMocks.update,
      isSaving: false,
    }),
  }
})

import { usePreferencesStore } from '../../state/preferences-store'
import { ShortcutsSection } from '../sections/ShortcutsSection'

const ACTION: ProjectAction = {
  id: 'tests',
  name: 'Run tests',
  command: 'pnpm test',
  icon: 'test',
  runOnWorktreeCreate: false,
  shortcutRules: [
    { shortcut: { key: 'R', mod: true }, when: 'terminalFocus', order: 4 },
    { shortcut: { key: 'R', mod: true, shift: true }, when: 'previewOpen', order: 7 },
  ],
}

describe('ShortcutsSection', () => {
  let persistedSettings: Settings

  beforeEach(() => {
    vi.clearAllMocks()
    projectMocks.actions = [ACTION]
    projectMocks.update.mockResolvedValue([ACTION])
    persistedSettings = { ...DEFAULT_SETTINGS, projectPath: '/repo' }
    usePreferencesStore.setState({ settings: persistedSettings })
    apiMock.updateSettings.mockImplementation(async (partial: Partial<Settings>) => {
      const shortcutRules = partial.shortcutRules ?? persistedSettings.shortcutRules
      persistedSettings = {
        ...persistedSettings,
        ...partial,
        shortcutRules,
        shortcutBindings: shortcutBindingsFromRules(shortcutRules),
      }
      return { ok: true }
    })
    apiMock.getSettings.mockImplementation(async () => persistedSettings)
  })

  it('searches built-in and every Project Action binding in one surface', () => {
    render(<ShortcutsSection />)

    expect(screen.getAllByText('Run tests')).toHaveLength(2)
    expect(
      screen.queryByRole('button', { name: 'Remove binding for Toggle sidebar' }),
    ).not.toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search keyboard shortcuts' }), {
      target: { value: 'pnpm test' },
    })
    expect(screen.getAllByText('Run tests')).toHaveLength(2)
    expect(screen.queryByText('Toggle sidebar')).not.toBeInTheDocument()
    expect(screen.getByText('0 built-in · 2 project')).toBeInTheDocument()
  })

  it('adds another conditional built-in rule instead of replacing the command', async () => {
    render(<ShortcutsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Add binding' }))
    const form = screen.getByRole('region', { name: 'Add keyboard binding' })
    fireEvent.change(within(form).getByRole('combobox', { name: 'Command for new binding' }), {
      target: { value: 'builtin:diff.toggle' },
    })
    const recorder = within(form).getByRole('button', { name: 'Record new keyboard binding' })
    fireEvent.click(recorder)
    fireEvent.keyDown(recorder, { key: 'r', ctrlKey: true })
    fireEvent.click(within(form).getByRole('button', { name: 'Condition' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Add binding' }))

    await waitFor(() => {
      const rules = usePreferencesStore.getState().settings.shortcutRules
      expect(rules).toHaveLength(DEFAULT_SHORTCUT_RULES.length + 1)
      expect(rules.at(-1)).toEqual({
        command: 'diff.toggle',
        shortcut: { key: 'R', mod: true },
        when: 'terminalFocus',
      })
    })
  })

  it('edits a Project Action condition visually and preserves its other ordered rule', async () => {
    render(<ShortcutsSection />)
    const rows = screen
      .getAllByRole('article')
      .filter((row) => within(row).queryByText('Run tests'))
    const second = rows.find((row) => within(row).queryByText('previewOpen', { selector: 'code' }))
    if (second === undefined) throw new Error('Expected preview Project Action binding')
    const summary = second.querySelector('summary')
    if (summary === null) throw new Error('Expected condition editor summary')
    fireEvent.click(summary)
    fireEvent.change(
      within(second).getByRole('combobox', { name: 'Condition variable previewOpen' }),
      { target: { value: 'modelPickerOpen' } },
    )
    fireEvent.click(within(second).getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(projectMocks.update).toHaveBeenCalledWith('tests', {
        shortcutRules: [
          ACTION.shortcutRules?.[0],
          { shortcut: { key: 'R', mod: true, shift: true }, when: 'modelPickerOpen' },
        ],
      }),
    )
  })

  it('shows conflicts but saves the newest overlapping built-in rule', async () => {
    render(<ShortcutsSection />)
    fireEvent.click(screen.getByRole('button', { name: 'Add binding' }))
    const form = screen.getByRole('region', { name: 'Add keyboard binding' })
    fireEvent.change(within(form).getByRole('combobox', { name: 'Command for new binding' }), {
      target: { value: 'builtin:sessionTree.toggle' },
    })
    const recorder = within(form).getByRole('button', { name: 'Record new keyboard binding' })
    fireEvent.click(recorder)
    fireEvent.keyDown(recorder, { key: 'b', ctrlKey: true })

    expect(within(form).getByText(/Conflicts with “Toggle sidebar”/)).toBeInTheDocument()
    fireEvent.click(within(form).getByRole('button', { name: 'Add binding' }))
    await waitFor(() =>
      expect(usePreferencesStore.getState().settings.shortcutRules.at(-1)).toMatchObject({
        command: 'sessionTree.toggle',
        shortcut: { key: 'B', mod: true },
      }),
    )
  })
})
