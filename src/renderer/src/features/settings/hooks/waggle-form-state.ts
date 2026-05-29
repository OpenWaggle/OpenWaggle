import { matchBy } from '@diegogbrisa/ts-match'
import { DOUBLE_FACTOR } from '@shared/constants/math'
import type { SupportedModelId } from '@shared/types/brand'
import {
  WAGGLE_INHERIT_MODEL,
  type WaggleAgentColor,
  type WaggleAgentSlot,
  type WaggleCollaborationMode,
  type WaggleConfig,
  type WagglePreset,
  type WaggleStopCondition,
} from '@shared/types/waggle'

const MAX_TURNS = 8

export interface WaggleFormState {
  readonly agents: readonly [WaggleAgentSlot, WaggleAgentSlot]
  readonly mode: WaggleCollaborationMode
  readonly stopCondition: WaggleStopCondition
  readonly maxTurns: number
}

export interface WagglePresetState {
  readonly activePresetId: string | null
  readonly error: string | null
}

export type WaggleFormAction =
  | { readonly type: 'load-preset'; readonly config: WaggleConfig }
  | { readonly type: 'set-agent-label'; readonly index: 0 | 1; readonly label: string }
  | { readonly type: 'set-agent-model'; readonly index: 0 | 1; readonly model: SupportedModelId }
  | { readonly type: 'set-agent-role'; readonly index: 0 | 1; readonly roleDescription: string }
  | { readonly type: 'set-agent-color'; readonly index: 0 | 1; readonly color: WaggleAgentColor }
  | { readonly type: 'set-stop-condition'; readonly stopCondition: WaggleStopCondition }
  | { readonly type: 'set-max-turns'; readonly maxTurns: number }

export type WagglePresetAction =
  | { readonly type: 'select-preset'; readonly activePresetId: string }
  | { readonly type: 'save-success'; readonly activePresetId: string }
  | { readonly type: 'clear-active-preset' }
  | { readonly type: 'clear-error' }
  | { readonly type: 'set-error'; readonly error: string }

export const INITIAL_WAGGLE_FORM_STATE: WaggleFormState = {
  agents: [
    {
      label: 'Agent A',
      model: WAGGLE_INHERIT_MODEL,
      roleDescription: '',
      color: 'blue',
    },
    {
      label: 'Agent B',
      model: WAGGLE_INHERIT_MODEL,
      roleDescription: '',
      color: 'amber',
    },
  ],
  mode: 'sequential',
  stopCondition: 'consensus',
  maxTurns: MAX_TURNS,
}

export const INITIAL_WAGGLE_PRESET_STATE: WagglePresetState = {
  activePresetId: null,
  error: null,
}

export function configMatchesPreset(config: WaggleConfig, preset: WagglePreset) {
  const pc = preset.config
  if (config.mode !== pc.mode) return false
  if (config.stop.primary !== pc.stop.primary) return false
  if (config.stop.maxTurnsSafety !== pc.stop.maxTurnsSafety) return false
  for (let i = 0; i < DOUBLE_FACTOR; i++) {
    const a = config.agents[i]
    const p = pc.agents[i]
    if (!a || !p) return false
    if (a.label !== p.label) return false
    if (a.model !== p.model) return false
    if (a.roleDescription !== p.roleDescription) return false
    if (a.color !== p.color) return false
  }
  return true
}

export function buildWaggleConfig(state: WaggleFormState): WaggleConfig {
  const [agentA, agentB] = state.agents
  return {
    mode: state.mode,
    agents: [agentA, agentB],
    stop: { primary: state.stopCondition, maxTurnsSafety: state.maxTurns },
  }
}

function updateAgentAt(
  agents: readonly [WaggleAgentSlot, WaggleAgentSlot],
  index: 0 | 1,
  update: (agent: WaggleAgentSlot) => WaggleAgentSlot,
): readonly [WaggleAgentSlot, WaggleAgentSlot] {
  if (index === 0) {
    return [update(agents[0]), agents[1]]
  }
  return [agents[0], update(agents[1])]
}

export function waggleFormReducer(
  state: WaggleFormState,
  action: WaggleFormAction,
): WaggleFormState {
  return matchBy(action, 'type')
    .with('load-preset', (value) => ({
      agents: value.config.agents,
      mode: value.config.mode,
      stopCondition: value.config.stop.primary,
      maxTurns: value.config.stop.maxTurnsSafety,
    }))
    .with('set-agent-label', (value) => ({
      ...state,
      agents: updateAgentAt(state.agents, value.index, (agent) => ({
        ...agent,
        label: value.label,
      })),
    }))
    .with('set-agent-model', (value) => ({
      ...state,
      agents: updateAgentAt(state.agents, value.index, (agent) => ({
        ...agent,
        model: value.model,
      })),
    }))
    .with('set-agent-role', (value) => ({
      ...state,
      agents: updateAgentAt(state.agents, value.index, (agent) => ({
        ...agent,
        roleDescription: value.roleDescription,
      })),
    }))
    .with('set-agent-color', (value) => ({
      ...state,
      agents: updateAgentAt(state.agents, value.index, (agent) => ({
        ...agent,
        color: value.color,
      })),
    }))
    .with('set-stop-condition', (value) => ({ ...state, stopCondition: value.stopCondition }))
    .with('set-max-turns', (value) => ({ ...state, maxTurns: value.maxTurns }))
    .exhaustive()
}

export function wagglePresetReducer(
  state: WagglePresetState,
  action: WagglePresetAction,
): WagglePresetState {
  return matchBy(action, 'type')
    .with('select-preset', (value) => ({ ...state, activePresetId: value.activePresetId }))
    .with('save-success', (value) => ({
      ...state,
      activePresetId: value.activePresetId,
      error: null,
    }))
    .with('clear-active-preset', () => ({ ...state, activePresetId: null }))
    .with('clear-error', () => ({ ...state, error: null }))
    .with('set-error', (value) => ({ ...state, error: value.error }))
    .exhaustive()
}
