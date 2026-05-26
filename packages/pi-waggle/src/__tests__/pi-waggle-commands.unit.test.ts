import { readFile } from 'node:fs/promises'
import { WAGGLE_INHERIT_MODEL } from '@openwaggle/waggle-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { userHomeDir } = vi.hoisted(() => ({
  userHomeDir: '/tmp/pi-waggle-commands-home',
}))

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => userHomeDir,
}))

import {
  getPiWaggleProjectPresetsPath,
  getPiWaggleUserPresetsPath,
  writePiWagglePresetsFile,
} from '../preset-storage'
import {
  activeModeStateEntry,
  configEditorJson,
  createHarness,
  customPreset,
  PROJECT_SCOPE_LABEL,
  projectDir,
  resetPiWaggleCommandTestFiles,
} from './pi-waggle-command-harness'

const EXPECTED_MAX_TURNS_SAFETY = 7
const UPDATED_PRESET_MAX_TURNS_SAFETY = 6
const WAGGLE_OFF_LABEL = 'Waggle Off — disable Waggle for this branch'
const ADD_PRESET_MENU_LABEL = 'Add custom preset…'
const MANAGE_PRESETS_MENU_LABEL = 'Manage presets…'
const PROJECT_PRESET_MENU_LABEL = 'Project Only — project · 4 turns · openai/gpt-5.5'
const ACTIVE_CODE_REVIEW_LABEL = '● Code Review — built-in · 4 turns · openai/gpt-5.5'
const EDIT_ACTIVE_CONFIG_LABEL = 'Edit active Waggle config…'
const ENABLE_PRESET_LABEL = 'Enable preset'

const DEFAULT_TEMPLATE_LABEL = 'Default template'
const MANAGE_EDIT_LABEL = 'Edit existing preset…'
const INHERIT_ACTIVE_LABEL = 'Use standard-mode model — active'

function configWizardSelectResponses(extra: readonly string[] = []) {
  return [INHERIT_ACTIVE_LABEL, 'blue', INHERIT_ACTIVE_LABEL, 'amber', 'consensus', ...extra]
}

function creationInputResponses(name: string, maxTurnsSafety = 4) {
  return [name, 'Architect', 'Reviewer', String(maxTurnsSafety)]
}

function creationEditorResponses(name: string) {
  return [`${name} description`, 'Plans the implementation', 'Reviews the implementation']
}

describe('pi-waggle default commands', () => {
  beforeEach(resetPiWaggleCommandTestFiles)

  it('opens a context-aware Waggle control center and enables a selected project preset', async () => {
    await writePiWagglePresetsFile(getPiWaggleProjectPresetsPath(projectDir), [
      customPreset('custom-project', 'Project Only'),
    ])
    const harness = createHarness({
      selectResponses: [PROJECT_PRESET_MENU_LABEL, ENABLE_PRESET_LABEL],
    })

    await harness.waggleCommand.handler('', harness.ctx)

    expect(harness.ctx.ui.select).toHaveBeenCalledTimes(2)
    expect(harness.ctx.ui.select).toHaveBeenCalledWith(
      'Waggle control center — off',
      expect.arrayContaining([
        'Code Review — built-in · 8 turns · openai/gpt-5.5',
        ADD_PRESET_MENU_LABEL,
        MANAGE_PRESETS_MENU_LABEL,
        PROJECT_PRESET_MENU_LABEL,
      ]),
    )
    expect(harness.appendedEntries).toEqual([
      {
        customType: 'pi-waggle.mode-state',
        data: expect.objectContaining({
          enabled: true,
          presetId: 'custom-project',
          config: expect.objectContaining({
            agents: [
              expect.objectContaining({ label: 'Custom A', model: WAGGLE_INHERIT_MODEL }),
              expect.objectContaining({ label: 'Custom B', model: WAGGLE_INHERIT_MODEL }),
            ],
          }),
        }),
      },
    ])
    expect(harness.ctx.ui.notify).toHaveBeenCalledWith('Waggle enabled: Project Only', 'info')
    expect(harness.sendMessage).not.toHaveBeenCalled()
  })

  it('enables /waggle <preset> without materializing inherited model bindings', async () => {
    const harness = createHarness()

    await harness.waggleCommand.handler('code-review', harness.ctx)

    expect(harness.appendedEntries).toEqual([
      {
        customType: 'pi-waggle.mode-state',
        data: expect.objectContaining({
          enabled: true,
          presetId: 'code-review',
          config: expect.objectContaining({
            agents: [
              expect.objectContaining({ model: WAGGLE_INHERIT_MODEL }),
              expect.objectContaining({ model: WAGGLE_INHERIT_MODEL }),
            ],
          }),
        }),
      },
    ])
    expect(harness.ctx.waitForIdle).not.toHaveBeenCalled()
    expect(harness.sendMessage).not.toHaveBeenCalled()
  })

  it('writes disabled mode state for /waggle off, the active menu off item, and /standard', async () => {
    const offHarness = createHarness()
    await offHarness.waggleCommand.handler('off', offHarness.ctx)

    const menuHarness = createHarness({
      branchEntries: [activeModeStateEntry(configEditorJson(4))],
      selectResponses: [WAGGLE_OFF_LABEL],
    })
    await menuHarness.waggleCommand.handler('', menuHarness.ctx)

    const standardHarness = createHarness()
    await standardHarness.standardCommand.handler('', standardHarness.ctx)

    for (const harness of [offHarness, menuHarness, standardHarness]) {
      expect(harness.appendedEntries).toEqual([
        {
          customType: 'pi-waggle.mode-state',
          data: expect.objectContaining({ enabled: false }),
        },
      ])
      expect(harness.ctx.ui.setWorkingMessage).toHaveBeenCalledWith()
    }
  })

  it('creates a new project preset from the guided Waggle wizard', async () => {
    const harness = createHarness({
      selectResponses: [
        ADD_PRESET_MENU_LABEL,
        DEFAULT_TEMPLATE_LABEL,
        ...configWizardSelectResponses([PROJECT_SCOPE_LABEL]),
      ],
      inputResponses: creationInputResponses('My Review'),
      editorResponses: creationEditorResponses('My Review'),
    })

    await harness.waggleCommand.handler('', harness.ctx)

    const raw = await readFile(getPiWaggleProjectPresetsPath(projectDir), 'utf-8')
    expect(JSON.parse(raw)).toMatchObject({
      wagglePresets: [
        expect.objectContaining({
          id: 'my-review',
          name: 'My Review',
          isBuiltIn: false,
          config: expect.objectContaining({
            agents: [
              expect.objectContaining({ model: WAGGLE_INHERIT_MODEL }),
              expect.objectContaining({ model: WAGGLE_INHERIT_MODEL }),
            ],
          }),
        }),
      ],
    })
  })

  it('edits a built-in preset from Manage presets by saving an override with the same id', async () => {
    const harness = createHarness({
      selectResponses: [
        MANAGE_PRESETS_MENU_LABEL,
        MANAGE_EDIT_LABEL,
        'Code Review (code-review) — built-in',
        ...configWizardSelectResponses([PROJECT_SCOPE_LABEL]),
      ],
      inputResponses: creationInputResponses('Code Review', UPDATED_PRESET_MAX_TURNS_SAFETY),
      editorResponses: creationEditorResponses('Code Review'),
    })

    await harness.waggleCommand.handler('', harness.ctx)

    const raw = await readFile(getPiWaggleProjectPresetsPath(projectDir), 'utf-8')
    expect(JSON.parse(raw)).toMatchObject({
      wagglePresets: [
        expect.objectContaining({
          id: 'code-review',
          name: 'Code Review',
          isBuiltIn: false,
          config: expect.objectContaining({
            stop: expect.objectContaining({ maxTurnsSafety: UPDATED_PRESET_MAX_TURNS_SAFETY }),
          }),
        }),
      ],
    })
  })

  it('edits the active branch max turns through the guided config editor', async () => {
    const harness = createHarness({
      branchEntries: [activeModeStateEntry(configEditorJson(4))],
      selectResponses: ['Set max turns — 4', 'Done'],
      inputResponses: [String(EXPECTED_MAX_TURNS_SAFETY)],
    })

    await harness.waggleCommand.handler('config', harness.ctx)

    expect(harness.appendedEntries).toEqual([
      {
        customType: 'pi-waggle.mode-state',
        data: expect.objectContaining({
          enabled: true,
          config: expect.objectContaining({
            stop: expect.objectContaining({ maxTurnsSafety: EXPECTED_MAX_TURNS_SAFETY }),
          }),
        }),
      },
    ])
  })

  it('edits the active config from the selected active preset row instead of a top-level edit row', async () => {
    const harness = createHarness({
      branchEntries: [activeModeStateEntry(configEditorJson(4))],
      selectResponses: [
        ACTIVE_CODE_REVIEW_LABEL,
        EDIT_ACTIVE_CONFIG_LABEL,
        'Set max turns — 4',
        'Done',
      ],
      inputResponses: [String(EXPECTED_MAX_TURNS_SAFETY)],
    })

    await harness.waggleCommand.handler('', harness.ctx)

    expect(harness.ctx.ui.select).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('Waggle control center — enabled'),
      expect.not.arrayContaining([expect.stringContaining('Edit current config')]),
    )
    expect(harness.ctx.ui.input).toHaveBeenCalledWith('Set Waggle max turns', '4')
    expect(harness.appendedEntries).toEqual([
      {
        customType: 'pi-waggle.mode-state',
        data: expect.objectContaining({
          enabled: true,
          config: expect.objectContaining({
            stop: expect.objectContaining({ maxTurnsSafety: EXPECTED_MAX_TURNS_SAFETY }),
          }),
        }),
      },
    ])
  })

  it('loads user and project presets for /waggle <preset> with project precedence', async () => {
    await writePiWagglePresetsFile(getPiWaggleUserPresetsPath(), [
      customPreset('custom-shared', 'User Shared'),
      customPreset('custom-user', 'User Only'),
    ])
    await writePiWagglePresetsFile(getPiWaggleProjectPresetsPath(projectDir), [
      customPreset('custom-shared', 'Project Shared'),
      customPreset('custom-project', 'Project Only'),
    ])
    const harness = createHarness()

    await harness.waggleCommand.handler('custom-shared', harness.ctx)

    expect(harness.appendedEntries).toEqual([
      {
        customType: 'pi-waggle.mode-state',
        data: expect.objectContaining({
          enabled: true,
          presetId: 'custom-shared',
          config: expect.objectContaining({
            agents: [
              expect.objectContaining({ label: 'Custom A', model: WAGGLE_INHERIT_MODEL }),
              expect.objectContaining({ label: 'Custom B', model: WAGGLE_INHERIT_MODEL }),
            ],
          }),
        }),
      },
    ])
    expect(harness.ctx.ui.notify).toHaveBeenCalledWith('Waggle enabled: Project Shared', 'info')
  })
})
