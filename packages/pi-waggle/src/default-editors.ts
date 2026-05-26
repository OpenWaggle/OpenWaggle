import type { ExtensionCommandContext, ExtensionContext } from '@mariozechner/pi-coding-agent'
import type { WaggleConfig, WagglePreset } from '@openwaggle/waggle-core'
import {
  blankConfig,
  editWaggleConfigGuided,
  promptFullWaggleConfig,
} from './default-config-editors'
import { promptPrefilledText } from './default-prefilled-input'
import { latestPiWaggleModeStateFromBranch } from './mode-state'
import {
  buildEditablePreset,
  loadPiWagglePresetLayers,
  mergePiWagglePresetLayers,
  type PiWaggleEditablePresetScope,
  type PiWaggleResolvedPreset,
  presetScopeLabel,
  resolvedPresetsForUi,
  savePiWagglePreset,
} from './presets'

export { viewAdvancedJson } from './default-json-editor'

const DEFAULT_NEW_PRESET_NAME = 'New Waggle Preset'
const DEFAULT_NEW_PRESET_DESCRIPTION = 'Describe what this Waggle preset is for.'
const PROJECT_SCOPE_LABEL = 'Project (.pi/waggle-presets.json)'
const USER_SCOPE_LABEL = 'User (~/.pi/agent/waggle-presets.json)'
const DEFAULT_TEMPLATE_LABEL = 'Default template'
const CURRENT_CONFIG_LABEL = 'Current Waggle configuration'
const EXISTING_PRESET_LABEL = 'Existing preset'

interface EditablePresetDraft {
  readonly name: string
  readonly description: string
  readonly config: WaggleConfig
}

function notify(ctx: ExtensionContext, message: string, type: 'info' | 'warning' | 'error') {
  if (ctx.hasUI) ctx.ui.notify(message, type)
}

function presetSelectionLabel(entry: PiWaggleResolvedPreset) {
  return `${entry.preset.name} (${entry.preset.id}) — ${entry.scope}`
}

function latestActiveConfig(ctx: ExtensionCommandContext) {
  const state = latestPiWaggleModeStateFromBranch(ctx.sessionManager)
  return state?.enabled && state.config ? state.config : null
}

async function promptLongText(input: {
  readonly ctx: ExtensionCommandContext
  readonly title: string
  readonly currentValue: string
}) {
  if (!input.ctx.hasUI) return input.currentValue
  const next = await input.ctx.ui.editor(input.title, `${input.currentValue}\n`)
  if (next === undefined) return null
  return next.trim() || input.currentValue
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

async function selectPreset(
  ctx: ExtensionCommandContext,
  presets: readonly PiWaggleResolvedPreset[],
  title: string,
) {
  if (!ctx.hasUI) return null
  const labels = presets.map((preset) => presetSelectionLabel(preset))
  const selectedLabel = await ctx.ui.select(title, labels)
  const selectedIndex = selectedLabel ? labels.indexOf(selectedLabel) : -1
  return selectedIndex >= 0 ? (presets[selectedIndex] ?? null) : null
}

async function selectDraftSource(ctx: ExtensionCommandContext) {
  if (!ctx.hasUI) {
    return {
      name: DEFAULT_NEW_PRESET_NAME,
      description: DEFAULT_NEW_PRESET_DESCRIPTION,
      config: blankConfig(),
    } satisfies EditablePresetDraft
  }

  const selected = await ctx.ui.select('Create custom Waggle preset from', [
    DEFAULT_TEMPLATE_LABEL,
    CURRENT_CONFIG_LABEL,
    EXISTING_PRESET_LABEL,
  ])
  if (!selected) return null

  if (selected === CURRENT_CONFIG_LABEL) {
    const config = latestActiveConfig(ctx)
    if (config) {
      return {
        name: DEFAULT_NEW_PRESET_NAME,
        description: DEFAULT_NEW_PRESET_DESCRIPTION,
        config,
      } satisfies EditablePresetDraft
    }
    notify(ctx, 'No active Waggle configuration to copy; using the default template.', 'warning')
  }

  if (selected === EXISTING_PRESET_LABEL) {
    const presets = resolvedPresetsForUi(await loadPiWagglePresetLayers(ctx.cwd))
    const source = await selectPreset(ctx, presets, 'Create Waggle preset from existing preset')
    if (!source) return null
    return {
      name: `${source.preset.name} Copy`,
      description: source.preset.description,
      config: source.preset.config,
    } satisfies EditablePresetDraft
  }

  return {
    name: DEFAULT_NEW_PRESET_NAME,
    description: DEFAULT_NEW_PRESET_DESCRIPTION,
    config: blankConfig(),
  } satisfies EditablePresetDraft
}

async function promptPresetDraft(input: {
  readonly ctx: ExtensionCommandContext
  readonly initialDraft: EditablePresetDraft
  readonly title: string
}) {
  const name = await promptPrefilledText({
    ctx: input.ctx,
    title: `${input.title}: preset name`,
    currentValue: input.initialDraft.name,
  })
  if (name === null) return null

  const description = await promptLongText({
    ctx: input.ctx,
    title: `${input.title}: preset description`,
    currentValue: input.initialDraft.description,
  })
  if (description === null) return null

  const config = await promptFullWaggleConfig({
    ctx: input.ctx,
    initialConfig: input.initialDraft.config,
  })
  if (!config) return null
  return { name, description, config } satisfies EditablePresetDraft
}

async function saveDraftAsPreset(input: {
  readonly ctx: ExtensionCommandContext
  readonly draft: EditablePresetDraft
  readonly existingId?: string
  readonly existingCreatedAt?: number
  readonly defaultScope: PiWaggleEditablePresetScope
}) {
  const layers = await loadPiWagglePresetLayers(input.ctx.cwd)
  const existingIds = new Set(mergePiWagglePresetLayers(layers).map((preset) => preset.preset.id))
  const scope = await selectPresetScope(input.ctx, input.defaultScope)
  if (!scope) return null

  const preset = buildEditablePreset({
    base: input.draft,
    ...(input.existingId ? { existingId: input.existingId } : {}),
    ...(input.existingCreatedAt !== undefined
      ? { existingCreatedAt: input.existingCreatedAt }
      : {}),
    existingIds,
  })
  await savePiWagglePreset({ cwd: input.ctx.cwd, scope, preset })
  notify(input.ctx, `Saved Waggle preset: ${preset.name}`, 'info')
  return preset
}

export async function createPresetFromEditor(input: { readonly ctx: ExtensionCommandContext }) {
  try {
    const sourceDraft = await selectDraftSource(input.ctx)
    if (!sourceDraft) return
    const draft = await promptPresetDraft({
      ctx: input.ctx,
      initialDraft: sourceDraft,
      title: 'Create Waggle preset',
    })
    if (draft) await saveDraftAsPreset({ ctx: input.ctx, draft, defaultScope: 'project' })
  } catch (error) {
    notify(input.ctx, error instanceof Error ? error.message : String(error), 'error')
  }
}

export async function saveConfigAsPreset(input: {
  readonly ctx: ExtensionCommandContext
  readonly config: WaggleConfig
  readonly defaultName?: string
}) {
  try {
    const draft = await promptPresetDraft({
      ctx: input.ctx,
      initialDraft: {
        name: input.defaultName ?? DEFAULT_NEW_PRESET_NAME,
        description: DEFAULT_NEW_PRESET_DESCRIPTION,
        config: input.config,
      },
      title: 'Save Waggle config as preset',
    })
    if (draft) await saveDraftAsPreset({ ctx: input.ctx, draft, defaultScope: 'project' })
  } catch (error) {
    notify(input.ctx, error instanceof Error ? error.message : String(error), 'error')
  }
}

export async function editPresetFromEditor(input: {
  readonly ctx: ExtensionCommandContext
  readonly presetId?: string
}) {
  try {
    const presets = resolvedPresetsForUi(await loadPiWagglePresetLayers(input.ctx.cwd))
    const existing = input.presetId
      ? (presets.find((candidate) => candidate.preset.id === input.presetId) ?? null)
      : null
    const selectedPreset =
      existing ?? (await selectPreset(input.ctx, presets, 'Edit Waggle preset'))
    if (!selectedPreset) {
      if (input.presetId) notify(input.ctx, `Unknown Waggle preset: ${input.presetId}`, 'error')
      return
    }

    const draft = await promptPresetDraft({
      ctx: input.ctx,
      initialDraft: {
        name: selectedPreset.preset.name,
        description: selectedPreset.preset.description,
        config: selectedPreset.preset.config,
      },
      title: `Edit Waggle preset "${selectedPreset.preset.name}"`,
    })
    if (!draft) return

    const defaultScope: PiWaggleEditablePresetScope =
      selectedPreset.scope === 'user' ? 'user' : 'project'
    await saveDraftAsPreset({
      ctx: input.ctx,
      draft,
      existingId: selectedPreset.preset.id,
      existingCreatedAt: selectedPreset.preset.createdAt,
      defaultScope,
    })
  } catch (error) {
    notify(input.ctx, error instanceof Error ? error.message : String(error), 'error')
  }
}

export async function editConfigBeforeEnabling(input: {
  readonly ctx: ExtensionCommandContext
  readonly preset: WagglePreset
}) {
  try {
    return await editWaggleConfigGuided({
      ctx: input.ctx,
      initialConfig: input.preset.config,
      title: `Edit before enabling — ${input.preset.name}`,
    })
  } catch (error) {
    notify(input.ctx, error instanceof Error ? error.message : String(error), 'error')
    return null
  }
}
