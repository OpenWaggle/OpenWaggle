import { DEFAULT_BRANCH_UI_STATE_JSON, STANDARD_FUTURE_MODE, WAGGLE_FUTURE_MODE } from './constants'
import type { BranchStateValue, BranchStateValueInput } from './types'

function activeWaggleBranchState(input: BranchStateValueInput): BranchStateValue {
  return {
    futureMode: WAGGLE_FUTURE_MODE,
    wagglePresetId: null,
    waggleConfigJson: JSON.stringify(input.waggleConfig),
    lastActiveAt: input.now,
    uiStateJson: input.existingState?.ui_state_json ?? DEFAULT_BRANCH_UI_STATE_JSON,
  }
}

function modeStateBranchState(input: BranchStateValueInput): BranchStateValue {
  return {
    futureMode: input.modeState?.enabled ? WAGGLE_FUTURE_MODE : STANDARD_FUTURE_MODE,
    wagglePresetId: input.modeState?.presetId ?? null,
    waggleConfigJson:
      input.modeState?.enabled && input.modeState.config
        ? JSON.stringify(input.modeState.config)
        : null,
    lastActiveAt: lastActiveAt(input),
    uiStateJson: input.existingState?.ui_state_json ?? DEFAULT_BRANCH_UI_STATE_JSON,
  }
}

function lastActiveAt(input: BranchStateValueInput) {
  if (input.branch.id === input.activeBranchId) {
    return input.now
  }

  return input.existingState?.last_active_at ?? input.now
}

function existingBranchState(input: BranchStateValueInput): BranchStateValue {
  return {
    futureMode: input.existingState?.future_mode ?? STANDARD_FUTURE_MODE,
    wagglePresetId: input.existingState?.waggle_preset_id ?? null,
    waggleConfigJson: input.existingState?.waggle_config_json ?? null,
    lastActiveAt: lastActiveAt(input),
    uiStateJson: input.existingState?.ui_state_json ?? DEFAULT_BRANCH_UI_STATE_JSON,
  }
}

export function getBranchStateValue(input: BranchStateValueInput): BranchStateValue {
  if (input.modeState) {
    return modeStateBranchState(input)
  }

  if (input.branch.id === input.activeBranchId && input.waggleConfig) {
    return activeWaggleBranchState(input)
  }

  return existingBranchState(input)
}
