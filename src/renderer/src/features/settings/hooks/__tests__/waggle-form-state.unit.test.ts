import { SupportedModelId, WagglePresetId } from '@shared/types/brand'
import { WAGGLE_INHERIT_MODEL, type WagglePreset } from '@shared/types/waggle'
import { describe, expect, it } from 'vitest'
import {
  buildWaggleConfig,
  configMatchesPreset,
  INITIAL_WAGGLE_FORM_STATE,
  INITIAL_WAGGLE_PRESET_STATE,
  waggleFormReducer,
  wagglePresetReducer,
} from '../waggle-form-state'

function makePreset(): WagglePreset {
  return {
    id: WagglePresetId('preset-1'),
    name: 'Pair',
    description: 'Two-agent workflow',
    isBuiltIn: false,
    createdAt: 1,
    updatedAt: 1,
    config: {
      mode: 'sequential',
      agents: [
        {
          label: 'Planner',
          model: SupportedModelId('anthropic/claude-sonnet-4-5'),
          roleDescription: 'Plans the work',
          color: 'blue',
        },
        {
          label: 'Reviewer',
          model: SupportedModelId('openai/gpt-4o'),
          roleDescription: 'Reviews the result',
          color: 'amber',
        },
      ],
      stop: { primary: 'consensus', maxTurnsSafety: 8 },
    },
  }
}

describe('waggle form state reducers', () => {
  it('builds a Waggle config from editable form state', () => {
    const config = buildWaggleConfig(INITIAL_WAGGLE_FORM_STATE)

    expect(config).toMatchObject({
      mode: 'sequential',
      stop: { primary: 'consensus', maxTurnsSafety: 8 },
    })
    expect(config.agents.map((agent) => agent.label)).toEqual(['Agent A', 'Agent B'])
    expect(config.agents.map((agent) => agent.model)).toEqual([
      WAGGLE_INHERIT_MODEL,
      WAGGLE_INHERIT_MODEL,
    ])
  })

  it('detects whether a form config still matches a preset exactly', () => {
    const preset = makePreset()
    expect(configMatchesPreset(preset.config, preset)).toBe(true)

    expect(
      configMatchesPreset(
        {
          ...preset.config,
          agents: [{ ...preset.config.agents[0], label: 'Changed' }, preset.config.agents[1]],
        },
        preset,
      ),
    ).toBe(false)
  })

  it('loads a preset config into form state', () => {
    const preset = makePreset()

    expect(
      waggleFormReducer(INITIAL_WAGGLE_FORM_STATE, { type: 'load-preset', config: preset.config }),
    ).toEqual({
      agents: preset.config.agents,
      mode: preset.config.mode,
      stopCondition: preset.config.stop.primary,
      maxTurns: preset.config.stop.maxTurnsSafety,
    })
  })

  it('updates a single agent without replacing the other slot', () => {
    const updated = waggleFormReducer(INITIAL_WAGGLE_FORM_STATE, {
      type: 'set-agent-label',
      index: 1,
      label: 'Critic',
    })

    expect(updated.agents[0]).toBe(INITIAL_WAGGLE_FORM_STATE.agents[0])
    expect(updated.agents[1].label).toBe('Critic')
  })

  it('updates stop controls independently from agent slots', () => {
    const withStop = waggleFormReducer(INITIAL_WAGGLE_FORM_STATE, {
      type: 'set-stop-condition',
      stopCondition: 'user-stop',
    })
    const withTurns = waggleFormReducer(withStop, { type: 'set-max-turns', maxTurns: 12 })

    expect(withTurns.stopCondition).toBe('user-stop')
    expect(withTurns.maxTurns).toBe(12)
    expect(withTurns.agents).toBe(INITIAL_WAGGLE_FORM_STATE.agents)
  })

  it('tracks selected preset and clears errors after successful save', () => {
    const withError = wagglePresetReducer(INITIAL_WAGGLE_PRESET_STATE, {
      type: 'set-error',
      error: 'Save failed',
    })
    const saved = wagglePresetReducer(withError, {
      type: 'save-success',
      activePresetId: 'preset-1',
    })

    expect(saved).toEqual({ activePresetId: 'preset-1', error: null })
    expect(wagglePresetReducer(saved, { type: 'clear-active-preset' }).activePresetId).toBeNull()
  })
})
