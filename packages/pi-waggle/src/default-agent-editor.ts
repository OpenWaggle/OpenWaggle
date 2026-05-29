import type { ExtensionCommandContext, ExtensionContext } from '@mariozechner/pi-coding-agent'
import {
  isWaggleInheritedModel,
  WAGGLE_AGENT_COLORS,
  WAGGLE_INHERIT_MODEL,
  type WaggleAgentColor,
  type WaggleAgentSlot,
} from '@openwaggle/waggle-core'
import { modelReferenceForCurrentModel, selectConcreteModelReference } from './default-model-picker'
import { promptPrefilledText } from './default-prefilled-input'

const PROMPT_PREVIEW_MAX_LENGTH = 72

function truncateText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

function normalizePromptPreview(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  const firstSentenceEnd = normalized.search(/[.!?](\s|$)/)
  const preview = firstSentenceEnd >= 0 ? normalized.slice(0, firstSentenceEnd + 1) : normalized
  return truncateText(preview, PROMPT_PREVIEW_MAX_LENGTH)
}

function effectiveModelLabel(ctx: ExtensionContext, model: string) {
  if (!isWaggleInheritedModel(model)) return model
  return modelReferenceForCurrentModel(ctx) ?? 'no standard model selected'
}

export function agentMenuLabel(ctx: ExtensionContext, agent: WaggleAgentSlot) {
  return `${agent.label} — ${effectiveModelLabel(ctx, agent.model)} · ${normalizePromptPreview(agent.roleDescription)}`
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

async function promptColor(ctx: ExtensionCommandContext, currentColor: WaggleAgentColor) {
  if (!ctx.hasUI) return currentColor
  const selected = await ctx.ui.select('Choose Waggle agent color', [...WAGGLE_AGENT_COLORS])
  for (const color of WAGGLE_AGENT_COLORS) {
    if (selected === color) return color
  }
  return null
}

async function editAgentModel(input: {
  readonly ctx: ExtensionCommandContext
  readonly agent: WaggleAgentSlot
}) {
  if (!input.ctx.hasUI) return input.agent.model

  const inheritedLabel = isWaggleInheritedModel(input.agent.model)
    ? 'Use standard-mode model — active'
    : 'Use standard-mode model — switch from pinned'
  const pinLabel = 'Pin concrete model…'
  const selected = await input.ctx.ui.select('Edit Waggle agent model binding', [
    inheritedLabel,
    pinLabel,
    'Back',
  ])

  if (!selected || selected === 'Back') return input.agent.model
  if (selected === inheritedLabel) return WAGGLE_INHERIT_MODEL

  const concrete = await selectConcreteModelReference({
    ctx: input.ctx,
    currentModelReference: isWaggleInheritedModel(input.agent.model) ? null : input.agent.model,
  })
  return concrete ?? input.agent.model
}

interface AgentEditMenu {
  readonly modelBindingLabel: string
  readonly options: string[]
}

type AgentEditResult =
  | {
      readonly action: 'continue'
      readonly agent: WaggleAgentSlot
    }
  | {
      readonly action: 'done'
      readonly agent: WaggleAgentSlot
    }

function agentEditMenu(ctx: ExtensionContext, agent: WaggleAgentSlot): AgentEditMenu {
  const modelBindingLabel = isWaggleInheritedModel(agent.model)
    ? 'Use standard-mode model — active'
    : 'Use standard-mode model — switch from pinned'

  return {
    modelBindingLabel,
    options: [
      `Edit label — ${agent.label}`,
      `Edit role prompt — ${normalizePromptPreview(agent.roleDescription)}`,
      `Change model — ${effectiveModelLabel(ctx, agent.model)}`,
      modelBindingLabel,
      `Change color — ${agent.color}`,
      'Back',
    ],
  }
}

async function editSelectedAgentField(input: {
  readonly ctx: ExtensionCommandContext
  readonly agent: WaggleAgentSlot
  readonly selected: string | undefined
  readonly modelBindingLabel: string
}): Promise<AgentEditResult> {
  if (!input.selected || input.selected === 'Back') {
    return { action: 'done', agent: input.agent }
  }

  if (input.selected.startsWith('Edit label')) {
    const label = await promptPrefilledText({
      ctx: input.ctx,
      title: `Agent label for ${input.agent.label}`,
      currentValue: input.agent.label,
    })
    return label === null
      ? { action: 'done', agent: input.agent }
      : { action: 'continue', agent: { ...input.agent, label } }
  }

  if (input.selected.startsWith('Edit role prompt')) {
    const roleDescription = await promptLongText({
      ctx: input.ctx,
      title: `Role prompt for ${input.agent.label}`,
      currentValue: input.agent.roleDescription,
    })
    return roleDescription === null
      ? { action: 'done', agent: input.agent }
      : { action: 'continue', agent: { ...input.agent, roleDescription } }
  }

  if (input.selected.startsWith('Change model')) {
    return {
      action: 'continue',
      agent: {
        ...input.agent,
        model: await editAgentModel({ ctx: input.ctx, agent: input.agent }),
      },
    }
  }

  if (input.selected === input.modelBindingLabel) {
    return { action: 'continue', agent: { ...input.agent, model: WAGGLE_INHERIT_MODEL } }
  }

  if (!input.selected.startsWith('Change color')) {
    return { action: 'continue', agent: input.agent }
  }

  const color = await promptColor(input.ctx, input.agent.color)
  return color === null
    ? { action: 'done', agent: input.agent }
    : { action: 'continue', agent: { ...input.agent, color } }
}

export async function editAgentSlot(input: {
  readonly ctx: ExtensionCommandContext
  readonly agent: WaggleAgentSlot
}) {
  if (!input.ctx.hasUI) return input.agent

  let agent = input.agent
  while (true) {
    const menu = agentEditMenu(input.ctx, agent)
    const selected = await input.ctx.ui.select(`Edit Waggle agent — ${agent.label}`, menu.options)
    const result = await editSelectedAgentField({
      ctx: input.ctx,
      agent,
      selected,
      modelBindingLabel: menu.modelBindingLabel,
    })

    if (result.action === 'done') return result.agent
    agent = result.agent
  }
}

export async function promptAgentSlot(input: {
  readonly ctx: ExtensionCommandContext
  readonly agent: WaggleAgentSlot
}) {
  const label = await promptPrefilledText({
    ctx: input.ctx,
    title: `Agent label for ${input.agent.label}`,
    currentValue: input.agent.label,
  })
  if (label === null) return null

  const roleDescription = await promptLongText({
    ctx: input.ctx,
    title: `Role prompt for ${label}`,
    currentValue: input.agent.roleDescription,
  })
  if (roleDescription === null) return null

  const model = await editAgentModel({ ctx: input.ctx, agent: { ...input.agent, label } })
  const color = await promptColor(input.ctx, input.agent.color)
  if (color === null) return null

  return { ...input.agent, label, roleDescription, model, color } satisfies WaggleAgentSlot
}
