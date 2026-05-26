import type { ExtensionCommandContext } from '@mariozechner/pi-coding-agent'
import {
  activateConfig,
  activatePreset,
  disableWaggle,
  latestActiveState,
} from './default-command-runtime'
import type { DefaultWaggleCommandInput } from './default-command-types'
import { editActiveConfig } from './default-config-editors'
import { buildWaggleMenuRows, menuTitle } from './default-control-center-rows'
import type { WaggleControlCenterRow, WaggleMenuAction } from './default-control-center-view'
import {
  createPresetFromEditor,
  editConfigBeforeEnabling,
  editPresetFromEditor,
  saveConfigAsPreset,
  viewAdvancedJson,
} from './default-editors'
import { managePresets } from './default-preset-management'
import { loadPiWagglePresetLayers, resolvedPresetsForUi } from './presets'

const FIRST_PRESET_INDEX = 0
const ENABLE_PRESET_LABEL = 'Enable preset'
const EDIT_BEFORE_ENABLE_LABEL = 'Edit before enabling…'
const SAVE_CUSTOM_COPY_LABEL = 'Save a custom copy…'
const VIEW_ADVANCED_JSON_LABEL = 'View advanced JSON'
const EDIT_ACTIVE_CONFIG_LABEL = 'Edit active Waggle config…'
const SAVE_ACTIVE_CONFIG_LABEL = 'Save active config as preset…'
const BACK_LABEL = 'Back'

type WaggleMenuNavigation = 'back' | 'close'

const BACK_TO_MENU: WaggleMenuNavigation = 'back'
const CLOSE_MENU: WaggleMenuNavigation = 'close'

function actionForSelectedRow(row: WaggleControlCenterRow) {
  return row.secondaryAction ?? row.primaryAction
}

async function selectWaggleMenuAction(
  ctx: ExtensionCommandContext,
  title: string,
  rows: readonly WaggleControlCenterRow[],
) {
  const selectedLabel = await ctx.ui.select(
    title,
    rows.map((row) => row.label),
  )
  const selectedRow = rows.find((candidate) => candidate.label === selectedLabel)
  return selectedRow ? actionForSelectedRow(selectedRow) : undefined
}

async function runActiveConfigActions(
  input: Pick<DefaultWaggleCommandInput, 'ctx' | 'pi'>,
  action: Extract<WaggleMenuAction, { readonly type: 'active-config-actions' }>,
) {
  if (!input.ctx.hasUI) return CLOSE_MENU
  const selected = await input.ctx.ui.select('Active Waggle config', [
    EDIT_ACTIVE_CONFIG_LABEL,
    SAVE_ACTIVE_CONFIG_LABEL,
    VIEW_ADVANCED_JSON_LABEL,
    BACK_LABEL,
  ])
  if (selected === BACK_LABEL) return BACK_TO_MENU
  if (!selected) return CLOSE_MENU
  if (selected === EDIT_ACTIVE_CONFIG_LABEL) {
    await editActiveConfig(input)
    return CLOSE_MENU
  }
  if (selected === SAVE_ACTIVE_CONFIG_LABEL) {
    await saveConfigAsPreset({ ctx: input.ctx, config: action.config })
    return CLOSE_MENU
  }
  await viewAdvancedJson({
    ctx: input.ctx,
    title: 'Active Waggle config JSON',
    value: action.config,
  })
  return CLOSE_MENU
}

async function runInactivePresetAction(
  input: DefaultWaggleCommandInput,
  action: Extract<WaggleMenuAction, { readonly type: 'preset-actions' }>,
  selected: string,
) {
  if (selected === ENABLE_PRESET_LABEL) {
    await activatePreset({ ...input, preset: action.preset })
    return CLOSE_MENU
  }
  if (selected === EDIT_BEFORE_ENABLE_LABEL) {
    const config = await editConfigBeforeEnabling({ ctx: input.ctx, preset: action.preset })
    if (config) await activateConfig({ ...input, config, presetName: 'custom configuration' })
    return CLOSE_MENU
  }
  if (selected === SAVE_CUSTOM_COPY_LABEL) {
    await saveConfigAsPreset({
      ctx: input.ctx,
      config: action.preset.config,
      defaultName: `${action.preset.name} Copy`,
    })
    return CLOSE_MENU
  }
  await viewAdvancedJson({
    ctx: input.ctx,
    title: `Waggle preset JSON — ${action.preset.name}`,
    value: action.preset,
  })
  return CLOSE_MENU
}

async function runActivePresetAction(input: DefaultWaggleCommandInput, selected: string) {
  if (selected === EDIT_ACTIVE_CONFIG_LABEL) {
    await editActiveConfig({ pi: input.pi, ctx: input.ctx })
    return CLOSE_MENU
  }
  const activeState = latestActiveState(input.ctx)
  if (selected === SAVE_ACTIVE_CONFIG_LABEL) {
    if (activeState) await saveConfigAsPreset({ ctx: input.ctx, config: activeState.config })
    return CLOSE_MENU
  }
  if (activeState) {
    await viewAdvancedJson({
      ctx: input.ctx,
      title: 'Active Waggle config JSON',
      value: activeState.config,
    })
  }
  return CLOSE_MENU
}

async function runPresetActions(
  input: DefaultWaggleCommandInput,
  action: Extract<WaggleMenuAction, { readonly type: 'preset-actions' }>,
) {
  if (!input.ctx.hasUI) return CLOSE_MENU
  const selected = await input.ctx.ui.select(
    action.active ? `Active preset — ${action.preset.name}` : `Preset — ${action.preset.name}`,
    action.active
      ? [EDIT_ACTIVE_CONFIG_LABEL, SAVE_ACTIVE_CONFIG_LABEL, VIEW_ADVANCED_JSON_LABEL, BACK_LABEL]
      : [
          ENABLE_PRESET_LABEL,
          EDIT_BEFORE_ENABLE_LABEL,
          SAVE_CUSTOM_COPY_LABEL,
          VIEW_ADVANCED_JSON_LABEL,
          BACK_LABEL,
        ],
  )
  if (selected === BACK_LABEL) return BACK_TO_MENU
  if (!selected) return CLOSE_MENU
  if (action.active) return runActivePresetAction(input, selected)
  return runInactivePresetAction(input, action, selected)
}

async function runMenuAction(input: DefaultWaggleCommandInput, action: WaggleMenuAction) {
  if (action.type === 'disable') {
    disableWaggle(input)
    return CLOSE_MENU
  }
  if (action.type === 'create-preset') {
    await createPresetFromEditor({ ctx: input.ctx })
    return CLOSE_MENU
  }
  if (action.type === 'manage-presets') {
    const navigation = await managePresets({
      ctx: input.ctx,
      editPreset: () => editPresetFromEditor({ ctx: input.ctx }),
    })
    return navigation === BACK_TO_MENU ? BACK_TO_MENU : CLOSE_MENU
  }
  if (action.type === 'active-config-actions') return runActiveConfigActions(input, action)
  if (action.type === 'preset-actions') return runPresetActions(input, action)
  await activatePreset({ ...input, preset: action.preset })
  return CLOSE_MENU
}

export async function openWaggleControlCenter(input: DefaultWaggleCommandInput) {
  if (!input.ctx.hasUI) {
    const presets = resolvedPresetsForUi(await loadPiWagglePresetLayers(input.ctx.cwd))
    const preset = presets[FIRST_PRESET_INDEX]?.preset
    if (preset) await activatePreset({ ...input, preset })
    return
  }

  while (true) {
    const presets = resolvedPresetsForUi(await loadPiWagglePresetLayers(input.ctx.cwd))
    const rows = buildWaggleMenuRows(input.ctx, presets)
    const title = menuTitle(input.ctx, presets)
    const action = await selectWaggleMenuAction(input.ctx, title, rows)

    if (!action) return
    const result = await runMenuAction(input, action)
    if (result !== BACK_TO_MENU) return
  }
}
