import { getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all'
import { USAGE_STATISTICS_BUILT_IN_SKILLS } from '@shared/usage-statistics/built-in-skills'
import {
  USAGE_STATISTICS_CATALOG_PROVIDER_MODELS,
  USAGE_STATISTICS_CATALOG_SKILLS,
} from '@shared/usage-statistics/catalog.generated'
import { usageStatisticsFieldError } from '@shared/usage-statistics/validation'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const recorded = vi.hoisted(() => {
  const observations: unknown[] = []
  const tokens: unknown[] = []
  const models: unknown[] = []
  const accessModes: unknown[] = []
  return { observations, tokens, models, accessModes }
})

vi.mock('../../../usage-statistics/usage-statistics-enablement', () => ({
  isUsageStatisticsEnabled: () => true,
}))
vi.mock('../../../usage-statistics/usage-statistics-recorder', () => ({
  recordUsageStatistics: (observation: unknown) => recorded.observations.push(observation),
}))
vi.mock('../../../usage-statistics/usage-statistics-runs', () => ({
  addUsageStatisticsRunTokens: (...args: unknown[]) => recorded.tokens.push(args),
  noteUsageStatisticsRunModel: (...args: unknown[]) => recorded.models.push(args),
  noteUsageStatisticsRunAccessMode: (...args: unknown[]) => recorded.accessModes.push(args),
}))

import {
  notePiRunForUsageStatistics,
  observePiAssistantMessageForUsageStatistics,
  observePiCompactionForUsageStatistics,
  observePiToolUseForUsageStatistics,
  piBuiltinCatalogIdentity,
  piSkillCommandIdentifier,
  piSkillReadIdentifier,
  withUsageStatisticsAccessMode,
} from '../pi-usage-statistics'

const BUILTIN_MODEL = getBuiltinModels('anthropic')[0]

describe('Pi Usage statistics hooks', () => {
  beforeEach(() => {
    recorded.observations.length = 0
    recorded.tokens.length = 0
    recorded.models.length = 0
    recorded.accessModes.length = 0
  })

  it('notes each authorization mode the Run resolves and returns it unchanged', async () => {
    const modes = ['ask-for-approval', 'yolo'] as const
    let next = 0
    const resolve = withUsageStatisticsAccessMode('run-1', async () => modes[next++] ?? 'yolo')

    await expect(resolve()).resolves.toBe('ask-for-approval')
    await expect(resolve()).resolves.toBe('yolo')

    expect(recorded.accessModes).toEqual([
      ['run-1', 'ask-for-approval'],
      ['run-1', 'yolo'],
    ])
  })

  it('names only Pi built-in catalog providers and models', () => {
    expect(BUILTIN_MODEL).toBeDefined()
    if (!BUILTIN_MODEL) return
    expect(piBuiltinCatalogIdentity('anthropic', BUILTIN_MODEL.id)).toEqual({
      provider: 'anthropic',
      model: BUILTIN_MODEL.id,
    })
    expect(piBuiltinCatalogIdentity('anthropic', 'my-fine-tune')).toEqual({
      provider: 'anthropic',
      model: 'custom',
    })
    expect(piBuiltinCatalogIdentity('acme-gateway', BUILTIN_MODEL.id)).toEqual({
      provider: 'custom',
      model: 'custom',
    })
  })

  it('maps against the generated catalog the endpoint enforces, which matches Pi and its skills', () => {
    const [provider, models] = Object.entries(USAGE_STATISTICS_CATALOG_PROVIDER_MODELS)[0] ?? []
    const model = models?.[0]
    expect(provider && model).toBeTruthy()
    if (!provider || !model) return
    expect(piBuiltinCatalogIdentity(provider, model)).toEqual({ provider, model })
    // The generated file is current for the installed Pi and the declared built-in skills.
    expect(Object.keys(USAGE_STATISTICS_CATALOG_PROVIDER_MODELS)).toEqual(
      getBuiltinProviders()
        .filter((id) => usageStatisticsFieldError({ kind: 'identifier' }, id) === undefined)
        .sort(),
    )
    expect(USAGE_STATISTICS_CATALOG_SKILLS).toEqual([...USAGE_STATISTICS_BUILT_IN_SKILLS].sort())
  })

  it('names built-in skills read from the OpenWaggle skill directory and nothing else', () => {
    expect(
      piSkillReadIdentifier('/Users/me/.pi/agent/openwaggle-built-in-skills/visualize/SKILL.md'),
    ).toBe('visualize')
    expect(
      piSkillReadIdentifier(
        'C:\\Users\\me\\.pi\\agent\\openwaggle-built-in-skills\\visualize\\SKILL.md',
      ),
    ).toBe('visualize')
    expect(piSkillReadIdentifier('/repo/.agents/skills/release/SKILL.md')).toBe('custom')
    expect(piSkillReadIdentifier('/repo/README.md')).toBeUndefined()
    expect(piSkillCommandIdentifier('/skill:visualize draw the pipeline')).toBe('visualize')
    expect(piSkillCommandIdentifier('/skill:secret-internal')).toBe('custom')
    expect(piSkillCommandIdentifier('please visualize this')).toBeUndefined()
  })

  it('notes the Run model, thinking level, extensions and an explicit skill command', () => {
    notePiRunForUsageStatistics(
      {
        runId: 'run-1',
        payload: { text: '/skill:visualize chart it' },
        session: { executionThinkingLevel: 'high' },
        enabledOpenWaggleExtensionPackages: [{}, {}],
      },
      { provider: 'acme-gateway', id: 'secret-model' },
      { thinkingLevel: 'low' },
    )

    expect(recorded.models).toEqual([['run-1', { provider: 'custom', model: 'custom' }, 'low']])
    expect(recorded.observations).toEqual([
      { kind: 'extensions-enabled', count: 2 },
      { kind: 'skill', identifier: 'visualize' },
    ])
  })

  it('falls back to the Session thinking level, then the default, when Pi reports none', () => {
    notePiRunForUsageStatistics(
      { runId: 'run-2', payload: { text: 'hi' }, session: { executionThinkingLevel: 'high' } },
      { provider: 'anthropic', id: 'claude-sonnet-4-5' },
      { thinkingLevel: undefined },
    )
    notePiRunForUsageStatistics(
      { runId: 'run-3', payload: { text: 'hi' }, session: {} },
      { provider: 'anthropic', id: 'claude-sonnet-4-5' },
      { thinkingLevel: 'not-a-level' },
    )

    expect(recorded.models).toEqual([
      ['run-2', { provider: 'anthropic', model: 'claude-sonnet-4-5' }, 'high'],
      ['run-3', { provider: 'anthropic', model: 'claude-sonnet-4-5' }, 'medium'],
    ])
  })

  it('maps tool use to browser automation and skill reads', () => {
    observePiToolUseForUsageStatistics('preview_click', { locator: 'role=button' })
    observePiToolUseForUsageStatistics('read', { path: '/repo/.agents/skills/qa/SKILL.md' })
    observePiToolUseForUsageStatistics('read', { path: '/repo/src/index.ts' })
    observePiToolUseForUsageStatistics('bash', { command: 'ls' })

    expect(recorded.observations).toEqual([
      { kind: 'feature', flag: 'browser_agent_driven' },
      { kind: 'skill', identifier: 'custom' },
    ])
  })

  it('sums prompt and cache tokens as input and detects inline visualizations', () => {
    observePiAssistantMessageForUsageStatistics('run-1', {
      usage: { input: 100, cacheRead: 900, cacheWrite: 50, output: 40 },
      content: [{ type: 'text', text: 'Here it is:\nvisualize{"path":"/tmp/v/chart.html"}' }],
    })

    expect(recorded.tokens).toEqual([['run-1', 1050, 40]])
    expect(recorded.observations).toEqual([{ kind: 'feature', flag: 'inline_visualization' }])
  })

  it('reports native and portable compaction, and ignores aborted ones', () => {
    observePiCompactionForUsageStatistics({
      aborted: false,
      result: { details: { mechanism: 'native' } },
    })
    observePiCompactionForUsageStatistics({
      aborted: false,
      result: { details: { mechanism: 'portable' } },
    })
    observePiCompactionForUsageStatistics({
      aborted: true,
      result: { details: { mechanism: 'native' } },
    })
    observePiCompactionForUsageStatistics({ aborted: false, result: { details: {} } })

    expect(recorded.observations).toEqual([
      { kind: 'run-compacted', mechanism: 'native' },
      { kind: 'run-compacted', mechanism: 'fallback' },
    ])
  })
})
