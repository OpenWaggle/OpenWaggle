const FIRST_AGENT_INDEX = 0
const SECOND_AGENT_INDEX = 1
export const MIN_WAGGLE_MAX_TURNS_SAFETY = 1
export const MAX_WAGGLE_MAX_TURNS_SAFETY = 100
const WAGGLE_AGENT_COUNT = 2
const MIN_TIMESTAMP = 0
const FIRST_PROVIDER_CHARACTER_INDEX = 0
const MODEL_ID_START_OFFSET = 1

export const WAGGLE_INHERIT_MODEL = '$inherit'
export const WAGGLE_COLLABORATION_MODES = ['sequential'] as const
export type WaggleCollaborationMode = (typeof WAGGLE_COLLABORATION_MODES)[number]

export const WAGGLE_AGENT_COLORS = ['blue', 'amber', 'emerald', 'violet'] as const
export type WaggleAgentColor = (typeof WAGGLE_AGENT_COLORS)[number]

export const WAGGLE_STOP_CONDITIONS = ['consensus', 'user-stop'] as const
export type WaggleStopCondition = (typeof WAGGLE_STOP_CONDITIONS)[number]

export interface WaggleAgentSlot {
  readonly label: string
  readonly model: string
  readonly roleDescription: string
  readonly color: WaggleAgentColor
}

export interface WaggleStopConfig {
  readonly primary: WaggleStopCondition
  readonly maxTurnsSafety: number
}

export interface WaggleConfig {
  readonly mode: WaggleCollaborationMode
  readonly agents: readonly [WaggleAgentSlot, WaggleAgentSlot]
  readonly stop: WaggleStopConfig
}

export interface WagglePreset {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly config: WaggleConfig
  readonly isBuiltIn: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

export type WaggleValidationResult<T> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly issues: readonly string[] }

/** The declared fields of `T`, each still unchecked: what a parser reads before it validates. */
type UncheckedFields<T> = { readonly [K in keyof T]?: unknown }

function valid<T>(value: T) {
  return { success: true, value } as const
}

function invalid(issues: readonly string[]) {
  return { success: false, issues } as const
}

function isObjectValue(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function literalValue<T extends string>(value: unknown, allowedValues: readonly T[], path: string) {
  if (typeof value !== 'string') {
    return invalid([`${path} must be a string.`])
  }

  for (const allowed of allowedValues) {
    if (value === allowed) {
      return valid(allowed)
    }
  }

  return invalid([`${path} must be one of: ${allowedValues.join(', ')}.`])
}

function stringValue(value: unknown, path: string) {
  if (typeof value !== 'string') {
    return invalid([`${path} must be a string.`])
  }

  return valid(value)
}

function booleanValue(value: unknown, path: string) {
  if (typeof value !== 'boolean') {
    return invalid([`${path} must be a boolean.`])
  }

  return valid(value)
}

function timestampValue(value: unknown, path: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < MIN_TIMESTAMP) {
    return invalid([`${path} must be a non-negative finite number.`])
  }

  return valid(value)
}

function collectIssues(results: readonly WaggleValidationResult<unknown>[]) {
  return results.flatMap((result) => (result.success ? [] : result.issues))
}

export function isWaggleInheritedModel(model: string): model is typeof WAGGLE_INHERIT_MODEL {
  return model === WAGGLE_INHERIT_MODEL
}

export function isProviderQualifiedWaggleModel(model: string) {
  const separatorIndex = model.indexOf('/')
  return (
    model.trim() === model &&
    separatorIndex > FIRST_PROVIDER_CHARACTER_INDEX &&
    separatorIndex < model.length - MODEL_ID_START_OFFSET
  )
}

function modelValue(value: unknown, path: string) {
  const model = stringValue(value, path)
  if (!model.success) return model

  if (isWaggleInheritedModel(model.value) || isProviderQualifiedWaggleModel(model.value)) {
    return model
  }

  return invalid([`${path} must be ${WAGGLE_INHERIT_MODEL} or a provider/model id.`])
}

function parseAgentSlot(value: unknown, path: string) {
  if (!isObjectValue(value)) {
    return invalid([`${path} must be an object.`])
  }

  const fields: UncheckedFields<WaggleAgentSlot> = value
  const label = stringValue(fields.label, `${path}.label`)
  const model = modelValue(fields.model, `${path}.model`)
  const roleDescription = stringValue(fields.roleDescription, `${path}.roleDescription`)
  const color = literalValue(fields.color, WAGGLE_AGENT_COLORS, `${path}.color`)
  const issues = collectIssues([label, model, roleDescription, color])
  if (
    issues.length > 0 ||
    !label.success ||
    !model.success ||
    !roleDescription.success ||
    !color.success
  ) {
    return invalid(issues)
  }

  return valid({
    label: label.value,
    model: model.value,
    roleDescription: roleDescription.value,
    color: color.value,
  })
}

function parseMaxTurnsSafety(value: unknown) {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_WAGGLE_MAX_TURNS_SAFETY ||
    value > MAX_WAGGLE_MAX_TURNS_SAFETY
  ) {
    return invalid([
      `stop.maxTurnsSafety must be an integer from ${String(MIN_WAGGLE_MAX_TURNS_SAFETY)} to ${String(MAX_WAGGLE_MAX_TURNS_SAFETY)}.`,
    ])
  }

  return valid(value)
}

function parseStopConfig(value: unknown) {
  if (!isObjectValue(value)) {
    return invalid(['stop must be an object.'])
  }

  const fields: UncheckedFields<WaggleStopConfig> = value
  const primary = literalValue(fields.primary, WAGGLE_STOP_CONDITIONS, 'stop.primary')
  const maxTurnsSafety = parseMaxTurnsSafety(fields.maxTurnsSafety)
  const issues = collectIssues([primary, maxTurnsSafety])
  if (issues.length > 0 || !primary.success || !maxTurnsSafety.success) {
    return invalid(issues)
  }

  return valid({
    primary: primary.value,
    maxTurnsSafety: maxTurnsSafety.value,
  })
}

function parseAgentTuple(value: unknown) {
  if (!Array.isArray(value) || value.length !== WAGGLE_AGENT_COUNT) {
    return invalid([`agents must contain exactly ${String(WAGGLE_AGENT_COUNT)} agent slots.`])
  }

  const first = parseAgentSlot(value[FIRST_AGENT_INDEX], 'agents[0]')
  const second = parseAgentSlot(value[SECOND_AGENT_INDEX], 'agents[1]')
  const issues = collectIssues([first, second])
  if (issues.length > 0 || !first.success || !second.success) {
    return invalid(issues)
  }

  return valid<readonly [WaggleAgentSlot, WaggleAgentSlot]>([first.value, second.value])
}

function waggleConfigValidation(value: unknown) {
  if (!isObjectValue(value)) {
    return invalid(['config must be an object.'])
  }

  const fields: UncheckedFields<WaggleConfig> = value
  const mode = literalValue(fields.mode, WAGGLE_COLLABORATION_MODES, 'mode')
  const agents = parseAgentTuple(fields.agents)
  const stop = parseStopConfig(fields.stop)
  const issues = collectIssues([mode, agents, stop])
  if (issues.length > 0 || !mode.success || !agents.success || !stop.success) {
    return invalid(issues)
  }

  return valid({
    mode: mode.value,
    agents: agents.value,
    stop: stop.value,
  })
}

function wagglePresetValidation(value: unknown) {
  if (!isObjectValue(value)) {
    return invalid(['preset must be an object.'])
  }

  const fields: UncheckedFields<WagglePreset> = value
  const id = stringValue(fields.id, 'id')
  const name = stringValue(fields.name, 'name')
  const description = stringValue(fields.description, 'description')
  const config = waggleConfigValidation(fields.config)
  const isBuiltIn = booleanValue(fields.isBuiltIn, 'isBuiltIn')
  const createdAt = timestampValue(fields.createdAt, 'createdAt')
  const updatedAt = timestampValue(fields.updatedAt, 'updatedAt')
  const issues = collectIssues([id, name, description, config, isBuiltIn, createdAt, updatedAt])

  if (
    issues.length > 0 ||
    !id.success ||
    !name.success ||
    !description.success ||
    !config.success ||
    !isBuiltIn.success ||
    !createdAt.success ||
    !updatedAt.success
  ) {
    return invalid(issues)
  }

  return valid({
    id: id.value,
    name: name.value,
    description: description.value,
    config: config.value,
    isBuiltIn: isBuiltIn.value,
    createdAt: createdAt.value,
    updatedAt: updatedAt.value,
  })
}

/* A typed result, so declarations name `WaggleValidationResult` instead of spelling out its union. */
export function parseWaggleConfig(value: unknown) {
  const result: WaggleValidationResult<WaggleConfig> = waggleConfigValidation(value)
  return result
}

export function parseWagglePreset(value: unknown) {
  const result: WaggleValidationResult<WagglePreset> = wagglePresetValidation(value)
  return result
}
