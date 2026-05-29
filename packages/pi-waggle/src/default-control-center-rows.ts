import type { ExtensionCommandContext, ExtensionContext } from '@mariozechner/pi-coding-agent'
import { isWaggleInheritedModel, type WaggleConfig } from '@openwaggle/waggle-core'
import { type ActiveWaggleState, latestActiveState } from './default-command-runtime'
import { modelReferenceForCurrentModel } from './default-config-editors'
import type { WaggleControlCenterRow, WaggleMenuAction } from './default-control-center-view'
import type { PiWaggleResolvedPreset } from './presets'

const DETAILS_PREVIEW_MAX_LENGTH = 78
const WAGGLE_OFF_LABEL = 'Waggle Off — disable Waggle for this branch'
const ADD_PRESET_MENU_LABEL = 'Add custom preset…'
const MANAGE_PRESETS_MENU_LABEL = 'Manage presets…'

function presetScopeLabel(scope: PiWaggleResolvedPreset['scope']) {
  if (scope === 'built-in') return 'built-in'
  return scope
}

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

function promptPreview(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  const firstSentenceEnd = normalized.search(/[.!?](\s|$)/)
  const preview = firstSentenceEnd >= 0 ? normalized.slice(0, firstSentenceEnd + 1) : normalized
  return truncateText(preview, DETAILS_PREVIEW_MAX_LENGTH)
}

function effectiveAgentModelLabel(ctx: ExtensionContext, model: string) {
  return isWaggleInheritedModel(model)
    ? (modelReferenceForCurrentModel(ctx) ?? 'no standard model selected')
    : model
}

function modelSummary(ctx: ExtensionContext, config: WaggleConfig) {
  const [firstAgent, secondAgent] = config.agents
  const firstModel = effectiveAgentModelLabel(ctx, firstAgent.model)
  const secondModel = effectiveAgentModelLabel(ctx, secondAgent.model)
  return firstModel === secondModel ? firstModel : 'mixed models'
}

function configRowSummary(ctx: ExtensionContext, config: WaggleConfig) {
  return `${String(config.stop.maxTurnsSafety)} turns · ${modelSummary(ctx, config)}`
}

function configDetails(ctx: ExtensionContext, config: WaggleConfig, description?: string) {
  const [firstAgent, secondAgent] = config.agents
  return [
    ...(description ? [description] : []),
    `Stop: ${config.stop.primary} · max ${String(config.stop.maxTurnsSafety)} turns`,
    `Agents: ${firstAgent.label} (${effectiveAgentModelLabel(ctx, firstAgent.model)}) ↔ ${secondAgent.label} (${effectiveAgentModelLabel(ctx, secondAgent.model)})`,
    `${firstAgent.label} prompt: ${promptPreview(firstAgent.roleDescription)}`,
    `${secondAgent.label} prompt: ${promptPreview(secondAgent.roleDescription)}`,
  ]
}

function activePreset(
  activeState: ActiveWaggleState | null,
  presets: readonly PiWaggleResolvedPreset[],
) {
  if (!activeState?.presetId) return null
  return presets.find((candidate) => candidate.preset.id === activeState.presetId)?.preset ?? null
}

export function menuTitle(
  ctx: ExtensionCommandContext,
  presets: readonly PiWaggleResolvedPreset[],
) {
  const activeState = latestActiveState(ctx)
  if (!activeState) return 'Waggle control center — off'
  const preset = activePreset(activeState, presets)
  const name = preset?.name ?? 'custom configuration'
  return `Waggle control center — enabled · ${name} · ${configRowSummary(ctx, activeState.config)}`
}

function buildActionRow(label: string, action: WaggleMenuAction): WaggleControlCenterRow {
  return { label, details: [label], primaryAction: action }
}

function buildPresetRow(input: {
  readonly ctx: ExtensionCommandContext
  readonly entry: PiWaggleResolvedPreset
  readonly active: boolean
  readonly activeConfig?: WaggleConfig
}): WaggleControlCenterRow {
  const displayConfig = input.activeConfig ?? input.entry.preset.config
  const activePrefix = input.active ? '● ' : ''
  return {
    label: `${activePrefix}${input.entry.preset.name} — ${presetScopeLabel(input.entry.scope)} · ${configRowSummary(input.ctx, displayConfig)}`,
    details: configDetails(input.ctx, displayConfig, input.entry.preset.description),
    primaryAction: input.active
      ? { type: 'active-config-actions', config: displayConfig, preset: input.entry.preset }
      : { type: 'activate-preset', preset: input.entry.preset },
    secondaryAction: { type: 'preset-actions', preset: input.entry.preset, active: input.active },
  }
}

function buildActiveCustomRow(
  ctx: ExtensionCommandContext,
  activeState: ActiveWaggleState,
): WaggleControlCenterRow {
  return {
    label: `● Active custom configuration — ${configRowSummary(ctx, activeState.config)}`,
    details: configDetails(ctx, activeState.config, 'Branch-scoped Waggle configuration.'),
    primaryAction: { type: 'active-config-actions', config: activeState.config },
    secondaryAction: { type: 'active-config-actions', config: activeState.config },
  }
}

export function buildWaggleMenuRows(
  ctx: ExtensionCommandContext,
  presets: readonly PiWaggleResolvedPreset[],
): readonly WaggleControlCenterRow[] {
  const activeState = latestActiveState(ctx)
  const activePresetId = activeState?.presetId
  const rows: WaggleControlCenterRow[] = []
  if (activeState) rows.push(buildActionRow(WAGGLE_OFF_LABEL, { type: 'disable' }))

  const hasActivePresetRow = Boolean(
    activePresetId && presets.some((entry) => entry.preset.id === activePresetId),
  )
  if (activeState && !hasActivePresetRow) rows.push(buildActiveCustomRow(ctx, activeState))

  for (const entry of presets) {
    const active = entry.preset.id === activePresetId
    rows.push(
      buildPresetRow({
        ctx,
        entry,
        active,
        ...(activeState && active ? { activeConfig: activeState.config } : {}),
      }),
    )
  }
  rows.push(buildActionRow(ADD_PRESET_MENU_LABEL, { type: 'create-preset' }))
  rows.push(buildActionRow(MANAGE_PRESETS_MENU_LABEL, { type: 'manage-presets' }))
  return rows
}
