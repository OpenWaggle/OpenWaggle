import type { ExtensionCommandContext, ExtensionContext } from '@mariozechner/pi-coding-agent'
import {
  deletePiWaggleCustomPreset,
  hiddenBuiltInPresetsForUi,
  loadPiWagglePresetLayers,
  type PiWaggleEditablePresetScope,
  type PiWaggleHiddenBuiltInPreset,
  type PiWaggleResolvedPreset,
  presetScopeLabel,
  resolvedPresetsForUi,
  restorePiWaggleBuiltInPreset,
  suppressPiWaggleBuiltInPreset,
} from './presets'

const PROJECT_SCOPE_LABEL = 'Project (.pi/waggle-presets.json)'
const USER_SCOPE_LABEL = 'User (~/.pi/agent/waggle-presets.json)'
const MANAGE_EDIT_LABEL = 'Edit existing preset…'
const MANAGE_DELETE_LABEL = 'Delete preset…'
const MANAGE_RESTORE_LABEL = 'Restore hidden presets…'

type PresetManagementNavigation = 'back' | 'close'

const BACK_TO_PARENT: PresetManagementNavigation = 'back'
const CLOSE_MENU: PresetManagementNavigation = 'close'
const BACK_LABEL = 'Back'

function notify(ctx: ExtensionContext, message: string, type: 'info' | 'warning' | 'error') {
  if (ctx.hasUI) ctx.ui.notify(message, type)
}

function presetSelectionLabel(entry: PiWaggleResolvedPreset) {
  return `${entry.preset.name} (${entry.preset.id}) — ${entry.scope}`
}

function hiddenPresetSelectionLabel(entry: PiWaggleHiddenBuiltInPreset) {
  return `${entry.preset.name} (${entry.preset.id}) — ${entry.scope}`
}

async function selectPresetScope(
  ctx: ExtensionCommandContext,
  defaultScope: PiWaggleEditablePresetScope,
) {
  if (!ctx.hasUI) return defaultScope
  const orderedScopes: readonly PiWaggleEditablePresetScope[] =
    defaultScope === 'project' ? ['project', 'user'] : ['user', 'project']
  const selected = await ctx.ui.select(
    'Save Waggle preset to',
    orderedScopes.map((scope) => presetScopeLabel(scope)),
  )
  return selected === PROJECT_SCOPE_LABEL
    ? 'project'
    : selected === USER_SCOPE_LABEL
      ? 'user'
      : null
}

async function selectPresetToDelete(
  ctx: ExtensionCommandContext,
  presets: readonly PiWaggleResolvedPreset[],
) {
  if (!ctx.hasUI) return null
  const labels = presets.map((preset) => presetSelectionLabel(preset))
  const selectedLabel = await ctx.ui.select('Delete Waggle preset', labels)
  const selectedIndex = selectedLabel ? labels.indexOf(selectedLabel) : -1
  return selectedIndex >= 0 ? (presets[selectedIndex] ?? null) : null
}

async function deletePreset(input: {
  readonly ctx: ExtensionCommandContext
  readonly preset: PiWaggleResolvedPreset
}) {
  if (!input.ctx.hasUI) return
  if (input.preset.scope === 'built-in') {
    const scope = await selectPresetScope(input.ctx, 'project')
    if (!scope) return
    const confirmed = await input.ctx.ui.confirm(
      'Hide built-in Waggle preset',
      `Hide ${input.preset.preset.name} in ${scope} scope?`,
    )
    if (!confirmed) return
    await suppressPiWaggleBuiltInPreset({
      cwd: input.ctx.cwd,
      scope,
      presetId: input.preset.preset.id,
    })
    notify(input.ctx, `Hidden built-in preset: ${input.preset.preset.name}`, 'info')
    return
  }

  const confirmed = await input.ctx.ui.confirm(
    'Delete Waggle preset',
    `Delete ${input.preset.preset.name} from ${input.preset.scope} presets?`,
  )
  if (!confirmed) return
  await deletePiWaggleCustomPreset({
    cwd: input.ctx.cwd,
    scope: input.preset.scope,
    presetId: input.preset.preset.id,
  })
  notify(input.ctx, `Deleted Waggle preset: ${input.preset.preset.name}`, 'info')
}

async function restoreHiddenPreset(input: {
  readonly ctx: ExtensionCommandContext
  readonly hiddenPresets: readonly PiWaggleHiddenBuiltInPreset[]
}) {
  if (!input.ctx.hasUI) return
  const labels = input.hiddenPresets.map((preset) => hiddenPresetSelectionLabel(preset))
  const selectedLabel = await input.ctx.ui.select('Restore hidden Waggle preset', labels)
  const selectedIndex = selectedLabel ? labels.indexOf(selectedLabel) : -1
  const selected = selectedIndex >= 0 ? input.hiddenPresets[selectedIndex] : undefined
  if (!selected) return
  await restorePiWaggleBuiltInPreset({
    cwd: input.ctx.cwd,
    scope: selected.scope,
    presetId: selected.preset.id,
  })
  notify(input.ctx, `Restored built-in preset: ${selected.preset.name}`, 'info')
}

type PresetManagementResult =
  | {
      readonly action: 'continue'
    }
  | {
      readonly action: 'return'
      readonly navigation: PresetManagementNavigation
    }

async function handlePresetManagementSelection(input: {
  readonly ctx: ExtensionCommandContext
  readonly selected: string | undefined
  readonly layers: Awaited<ReturnType<typeof loadPiWagglePresetLayers>>
  readonly hiddenPresets: readonly PiWaggleHiddenBuiltInPreset[]
  readonly editPreset: () => Promise<void>
}): Promise<PresetManagementResult> {
  if (input.selected === BACK_LABEL) {
    return { action: 'return', navigation: BACK_TO_PARENT }
  }

  if (!input.selected) {
    return { action: 'return', navigation: CLOSE_MENU }
  }

  if (input.selected === MANAGE_EDIT_LABEL) {
    await input.editPreset()
    return { action: 'continue' }
  }

  if (input.selected === MANAGE_DELETE_LABEL) {
    const preset = await selectPresetToDelete(input.ctx, resolvedPresetsForUi(input.layers))
    if (preset) await deletePreset({ ctx: input.ctx, preset })
    return { action: 'continue' }
  }

  if (input.selected === MANAGE_RESTORE_LABEL) {
    await restoreHiddenPreset({ ctx: input.ctx, hiddenPresets: input.hiddenPresets })
  }

  return { action: 'continue' }
}

export async function managePresets(input: {
  readonly ctx: ExtensionCommandContext
  readonly editPreset: () => Promise<void>
}): Promise<PresetManagementNavigation> {
  if (!input.ctx.hasUI) return CLOSE_MENU

  while (true) {
    const layers = await loadPiWagglePresetLayers(input.ctx.cwd)
    const hiddenPresets = hiddenBuiltInPresetsForUi(layers)
    const options = [
      MANAGE_EDIT_LABEL,
      MANAGE_DELETE_LABEL,
      ...(hiddenPresets.length > 0 ? [MANAGE_RESTORE_LABEL] : []),
      BACK_LABEL,
    ]
    const selected = await input.ctx.ui.select('Manage Waggle presets', options)
    const result = await handlePresetManagementSelection({
      ctx: input.ctx,
      selected,
      layers,
      hiddenPresets,
      editPreset: input.editPreset,
    })
    if (result.action === 'return') return result.navigation
  }
}
