import { describe, expect, it } from 'vitest'
import type { WaggleConfig } from '../config'
import { parseWaggleConfig, WAGGLE_INHERIT_MODEL } from '../config'
import { evaluateConsensus } from '../consensus'
import { BUILT_IN_WAGGLE_PRESETS, mergeWagglePresets } from '../presets'
import { buildWaggleTurnPrompt } from '../prompts'
import { completeWaggleTurn, startWaggleRun } from '../state'
import { decideNextWaggleTurn, getWaggleTurnAgentIndex } from '../turn-policy'

const FIRST_AGENT_INDEX = 0
const MAX_TURNS_SAFETY = 3
const FIRST_TURN = 0
const SECOND_TURN = 1
const THIRD_TURN = 2
const LOW_CONFIDENCE = 0.2
const HIGH_CONFIDENCE = 0.9

function config(): WaggleConfig {
  return {
    mode: 'sequential',
    agents: [
      {
        label: 'Architect',
        model: 'provider/architect',
        roleDescription: 'Designs the plan.',
        color: 'blue',
      },
      {
        label: 'Reviewer',
        model: 'provider/reviewer',
        roleDescription: 'Checks the plan.',
        color: 'amber',
      },
    ],
    stop: { primary: 'consensus', maxTurnsSafety: MAX_TURNS_SAFETY },
  }
}

describe('waggle-core', () => {
  it('validates Waggle config input', () => {
    const result = parseWaggleConfig(config())

    expect(result.success).toBe(true)
    expect(result.success ? result.value.agents[FIRST_AGENT_INDEX].label : null).toBe('Architect')
  })

  it('rejects invalid Waggle config input with readable issues', () => {
    const result = parseWaggleConfig({ ...config(), agents: [] })

    expect(result.success).toBe(false)
    expect(result.success ? [] : result.issues).toContain(
      'agents must contain exactly 2 agent slots.',
    )
  })

  it('rejects manually edited configs with a third agent', () => {
    const baseConfig = config()
    const result = parseWaggleConfig({
      ...baseConfig,
      agents: [...baseConfig.agents, { ...baseConfig.agents[0], label: 'Mediator' }],
    })

    expect(result.success).toBe(false)
    expect(result.success ? [] : result.issues).toContain(
      'agents must contain exactly 2 agent slots.',
    )
  })

  it('accepts explicit inherited model bindings and rejects blank model refs', () => {
    const inherited = parseWaggleConfig({
      ...config(),
      agents: [
        { ...config().agents[0], model: WAGGLE_INHERIT_MODEL },
        { ...config().agents[1], model: WAGGLE_INHERIT_MODEL },
      ],
    })
    const blank = parseWaggleConfig({
      ...config(),
      agents: [{ ...config().agents[0], model: '' }, config().agents[1]],
    })

    expect(inherited.success).toBe(true)
    expect(blank.success).toBe(false)
    expect(blank.success ? [] : blank.issues).toContain(
      `agents[0].model must be ${WAGGLE_INHERIT_MODEL} or a provider/model id.`,
    )
  })

  it('alternates sequential turn ownership between the two agents', () => {
    expect(getWaggleTurnAgentIndex(FIRST_TURN)).toBe(FIRST_TURN)
    expect(getWaggleTurnAgentIndex(SECOND_TURN)).toBe(SECOND_TURN)
    expect(getWaggleTurnAgentIndex(THIRD_TURN)).toBe(FIRST_TURN)
  })

  it('builds role-aware turn prompts', () => {
    const prompt = buildWaggleTurnPrompt({
      config: config(),
      turnNumber: SECOND_TURN,
      userPrompt: 'Review the repository architecture.',
    })

    expect(prompt).toContain('You are "Reviewer". Checks the plan.')
    expect(prompt).toContain('You are collaborating with "Architect"')
    expect(prompt).toContain('Review the session above and continue the collaboration.')
    expect(prompt).toContain('User request:\nReview the repository architecture.')
  })

  it('stops after the configured turn limit', () => {
    const decision = decideNextWaggleTurn(config(), { turnNumber: THIRD_TURN })

    expect(decision).toEqual({ continue: false, reason: 'turn-limit' })
  })

  it('advances run state when collaboration continues', () => {
    const initial = startWaggleRun({ config: config(), sessionId: 'waggle-session' })
    const next = completeWaggleTurn(initial, { turnNumber: FIRST_TURN })

    expect(next.status).toBe('running')
    expect(next.completedTurns).toHaveLength(SECOND_TURN)
    expect(next.currentTurn?.agentLabel).toBe('Reviewer')
  })

  it('completes run state when consensus is reached', () => {
    const initial = startWaggleRun({ config: config() })
    const next = completeWaggleTurn(initial, {
      turnNumber: FIRST_TURN,
      consensusReached: true,
    })

    expect(next.status).toBe('complete')
    expect(next.stopReason).toBe('consensus')
    expect(next.currentTurn).toBeNull()
  })

  it('ships built-in presets with Pi-native IDs', () => {
    expect(BUILT_IN_WAGGLE_PRESETS.map((preset) => preset.id)).toEqual([
      'code-review',
      'debate',
      'red-team',
    ])
  })

  it('merges presets with project presets taking precedence', () => {
    const [builtIn] = BUILT_IN_WAGGLE_PRESETS
    if (!builtIn) throw new Error('Expected built-in Waggle preset')
    const projectPreset = { ...builtIn, name: 'Project override', isBuiltIn: false }

    const result = mergeWagglePresets({
      builtIns: [builtIn],
      projectPresets: [projectPreset],
    })

    expect(result).toEqual([projectPreset])
  })

  it('evaluates consensus from the strongest signal', () => {
    const result = evaluateConsensus([
      { type: 'no-new-information', confidence: LOW_CONFIDENCE, reason: 'Still diverging.' },
      { type: 'explicit-agreement', confidence: HIGH_CONFIDENCE, reason: 'Both agents agree.' },
    ])

    expect(result).toMatchObject({
      reached: true,
      confidence: HIGH_CONFIDENCE,
      reason: 'Both agents agree.',
    })
  })
})
