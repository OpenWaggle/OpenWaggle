import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from '@mariozechner/pi-coding-agent'
import {
  MAX_WAGGLE_MAX_TURNS_SAFETY,
  MIN_WAGGLE_MAX_TURNS_SAFETY,
  parseWaggleConfig,
  WAGGLE_INHERIT_MODEL,
  WAGGLE_STOP_CONDITIONS,
  type WaggleConfig,
  type WaggleStopCondition,
} from '@openwaggle/waggle-core'
import { agentMenuLabel, editAgentSlot, promptAgentSlot } from './default-agent-editor'
import { modelReferenceForCurrentModel } from './default-model-picker'
import { promptPrefilledText } from './default-prefilled-input'
import {
  appendPiWaggleModeState,
  enabledPiWaggleModeState,
  latestPiWaggleModeStateFromBranch,
} from './mode-state'

export { modelReferenceForCurrentModel } from './default-model-picker'

const EDITOR_JSON_INDENT_SPACES = 2
const DEFAULT_FIRST_AGENT_LABEL = 'Agent 1'
const DEFAULT_SECOND_AGENT_LABEL = 'Agent 2'
const DEFAULT_FIRST_AGENT_ROLE = 'Plan the best approach and explain the structural reasoning.'
const DEFAULT_SECOND_AGENT_ROLE =
  'Stress-test the plan for correctness, risks, and missing details.'
const DEFAULT_STOP_CONDITION = 'consensus'
const DEFAULT_MAX_TURNS_SAFETY = 8
const ADVANCED_JSON_LABEL = 'Advanced JSON…'
const DONE_LABEL = 'Done'

function notify(ctx: ExtensionContext, message: string, type: 'info' | 'warning' | 'error') {
  if (ctx.hasUI) ctx.ui.notify(message, type)
}

function setWaggleStatus(ctx: ExtensionContext, text: string | undefined) {
  if (ctx.hasUI) ctx.ui.setStatus('pi-waggle', text)
}

function appendModeState(
  pi: Pick<ExtensionAPI, 'appendEntry'>,
  state: Parameters<typeof appendPiWaggleModeState>[1],
) {
  appendPiWaggleModeState(
    {
      appendCustomEntry: (customType, data) => {
        pi.appendEntry(customType, data)
        return undefined
      },
    },
    state,
  )
}

export function blankConfig(): WaggleConfig {
  return {
    mode: 'sequential',
    agents: [
      {
        label: DEFAULT_FIRST_AGENT_LABEL,
        model: WAGGLE_INHERIT_MODEL,
        roleDescription: DEFAULT_FIRST_AGENT_ROLE,
        color: 'blue',
      },
      {
        label: DEFAULT_SECOND_AGENT_LABEL,
        model: WAGGLE_INHERIT_MODEL,
        roleDescription: DEFAULT_SECOND_AGENT_ROLE,
        color: 'amber',
      },
    ],
    stop: { primary: DEFAULT_STOP_CONDITION, maxTurnsSafety: DEFAULT_MAX_TURNS_SAFETY },
  }
}

function stringifyConfigJson(config: WaggleConfig) {
  return `${JSON.stringify(config, null, EDITOR_JSON_INDENT_SPACES)}\n`
}

function parseEditedConfig(raw: string) {
  const configResult = parseWaggleConfig(JSON.parse(raw))
  if (!configResult.success) throw new Error(configResult.issues.join(' '))
  return configResult.value
}

function editableActiveConfig(ctx: ExtensionCommandContext) {
  const state = latestPiWaggleModeStateFromBranch(ctx.sessionManager)
  if (state?.enabled && state.config) return state.config

  if (!modelReferenceForCurrentModel(ctx)) {
    notify(ctx, 'Select a Pi model before editing Waggle configuration.', 'error')
    return null
  }

  return blankConfig()
}

function parseMaxTurns(raw: string) {
  const maxTurns = Number(raw.trim())
  if (
    !Number.isInteger(maxTurns) ||
    maxTurns < MIN_WAGGLE_MAX_TURNS_SAFETY ||
    maxTurns > MAX_WAGGLE_MAX_TURNS_SAFETY
  ) {
    throw new Error(
      `Max turns must be an integer from ${String(MIN_WAGGLE_MAX_TURNS_SAFETY)} to ${String(MAX_WAGGLE_MAX_TURNS_SAFETY)}.`,
    )
  }

  return maxTurns
}

async function promptStopCondition(
  ctx: ExtensionCommandContext,
  currentStopCondition: WaggleStopCondition,
) {
  if (!ctx.hasUI) return currentStopCondition
  const selected = await ctx.ui.select('Choose Waggle stop condition', [...WAGGLE_STOP_CONDITIONS])
  for (const stopCondition of WAGGLE_STOP_CONDITIONS) {
    if (selected === stopCondition) return stopCondition
  }
  return null
}

export async function promptFullWaggleConfig(input: {
  readonly ctx: ExtensionCommandContext
  readonly initialConfig: WaggleConfig
}) {
  const [firstAgent, secondAgent] = input.initialConfig.agents
  const nextFirstAgent = await promptAgentSlot({ ctx: input.ctx, agent: firstAgent })
  if (!nextFirstAgent) return null

  const nextSecondAgent = await promptAgentSlot({ ctx: input.ctx, agent: secondAgent })
  if (!nextSecondAgent) return null

  const stopCondition = await promptStopCondition(input.ctx, input.initialConfig.stop.primary)
  if (!stopCondition) return null

  const rawMaxTurns = await promptPrefilledText({
    ctx: input.ctx,
    title: 'Set Waggle max turns',
    currentValue: String(input.initialConfig.stop.maxTurnsSafety),
  })
  if (rawMaxTurns === null) return null

  const maxTurnsSafety = parseMaxTurns(rawMaxTurns)
  return {
    ...input.initialConfig,
    agents: [nextFirstAgent, nextSecondAgent],
    stop: { primary: stopCondition, maxTurnsSafety },
  } satisfies WaggleConfig
}

type GuidedConfigEditResult =
  | {
      readonly action: 'continue'
      readonly config: WaggleConfig
    }
  | {
      readonly action: 'done'
      readonly config: WaggleConfig
    }

function guidedConfigOptions(ctx: ExtensionCommandContext, config: WaggleConfig) {
  const [firstAgent, secondAgent] = config.agents
  return [
    `Edit ${agentMenuLabel(ctx, firstAgent)}`,
    `Edit ${agentMenuLabel(ctx, secondAgent)}`,
    `Set stop condition — ${config.stop.primary}`,
    `Set max turns — ${String(config.stop.maxTurnsSafety)}`,
    ADVANCED_JSON_LABEL,
    DONE_LABEL,
  ]
}

async function editSelectedConfigField(input: {
  readonly ctx: ExtensionCommandContext
  readonly config: WaggleConfig
  readonly selected: string | undefined
}): Promise<GuidedConfigEditResult> {
  if (!input.selected || input.selected === DONE_LABEL) {
    return { action: 'done', config: input.config }
  }

  const [firstAgent, secondAgent] = input.config.agents
  if (input.selected.startsWith(`Edit ${firstAgent.label}`)) {
    const nextAgent = await editAgentSlot({ ctx: input.ctx, agent: firstAgent })
    return { action: 'continue', config: { ...input.config, agents: [nextAgent, secondAgent] } }
  }

  if (input.selected.startsWith(`Edit ${secondAgent.label}`)) {
    const nextAgent = await editAgentSlot({ ctx: input.ctx, agent: secondAgent })
    return { action: 'continue', config: { ...input.config, agents: [firstAgent, nextAgent] } }
  }

  if (input.selected.startsWith('Set stop condition')) {
    const primary = await promptStopCondition(input.ctx, input.config.stop.primary)
    const config = primary
      ? { ...input.config, stop: { ...input.config.stop, primary } }
      : input.config
    return { action: 'continue', config }
  }

  if (input.selected.startsWith('Set max turns')) {
    const config = await editMaxTurnsConfig(input.ctx, input.config)
    return { action: 'continue', config }
  }

  if (input.selected !== ADVANCED_JSON_LABEL) {
    return { action: 'continue', config: input.config }
  }

  const config = await editAdvancedJsonConfig(input.ctx, input.config)
  return { action: 'continue', config }
}

async function editMaxTurnsConfig(ctx: ExtensionCommandContext, config: WaggleConfig) {
  const rawMaxTurns = await promptPrefilledText({
    ctx,
    title: 'Set Waggle max turns',
    currentValue: String(config.stop.maxTurnsSafety),
  })
  return rawMaxTurns === null
    ? config
    : { ...config, stop: { ...config.stop, maxTurnsSafety: parseMaxTurns(rawMaxTurns) } }
}

async function editAdvancedJsonConfig(ctx: ExtensionCommandContext, config: WaggleConfig) {
  const edited = await ctx.ui.editor('Advanced Waggle config JSON', stringifyConfigJson(config))
  return edited?.trim() ? parseEditedConfig(edited) : config
}

export async function editWaggleConfigGuided(input: {
  readonly ctx: ExtensionCommandContext
  readonly initialConfig: WaggleConfig
  readonly title: string
}) {
  if (!input.ctx.hasUI) return input.initialConfig

  let config = input.initialConfig
  while (true) {
    const selected = await input.ctx.ui.select(input.title, guidedConfigOptions(input.ctx, config))
    const result = await editSelectedConfigField({ ctx: input.ctx, config, selected })
    if (result.action === 'done') return result.config
    config = result.config
  }
}

export async function editActiveConfig(input: {
  readonly pi: Pick<ExtensionAPI, 'appendEntry'>
  readonly ctx: ExtensionCommandContext
}) {
  const config = editableActiveConfig(input.ctx)
  if (!config) return

  let nextConfig: WaggleConfig
  try {
    nextConfig = await editWaggleConfigGuided({
      ctx: input.ctx,
      initialConfig: config,
      title: 'Edit active Waggle config',
    })
  } catch (error) {
    notify(input.ctx, error instanceof Error ? error.message : String(error), 'error')
    return
  }

  appendModeState(input.pi, enabledPiWaggleModeState({ config: nextConfig }))
  setWaggleStatus(input.ctx, 'Waggle enabled: custom configuration')
  notify(input.ctx, 'Updated Waggle configuration for the current branch.', 'info')
}

export async function editActiveMaxTurns(input: {
  readonly pi: Pick<ExtensionAPI, 'appendEntry'>
  readonly ctx: ExtensionCommandContext
  readonly maxTurns?: string
}) {
  const config = editableActiveConfig(input.ctx)
  if (!config) return

  let rawMaxTurns: string | null | undefined = input.maxTurns
  if (rawMaxTurns === undefined) {
    if (!input.ctx.hasUI) {
      notify(input.ctx, 'Set max turns with /waggle turns <number>.', 'error')
      return
    }
    rawMaxTurns = await promptPrefilledText({
      ctx: input.ctx,
      title: 'Set Waggle max turns',
      currentValue: String(config.stop.maxTurnsSafety),
    })
  }
  if (!rawMaxTurns?.trim()) return

  let maxTurns: number
  try {
    maxTurns = parseMaxTurns(rawMaxTurns)
  } catch (error) {
    notify(input.ctx, error instanceof Error ? error.message : String(error), 'error')
    return
  }

  const nextConfig = {
    ...config,
    stop: { ...config.stop, maxTurnsSafety: maxTurns },
  } satisfies WaggleConfig
  appendModeState(input.pi, enabledPiWaggleModeState({ config: nextConfig }))
  setWaggleStatus(input.ctx, `Waggle enabled: custom configuration (${String(maxTurns)} turns)`)
  notify(input.ctx, `Updated Waggle max turns to ${String(maxTurns)}.`, 'info')
}
