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

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function literalValue<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  path: string,
): WaggleValidationResult<T> {
  if (typeof value !== 'string') {
    return { success: false, issues: [`${path} must be a string.`] }
  }

  for (const allowed of allowedValues) {
    if (value === allowed) {
      return { success: true, value: allowed }
    }
  }

  return { success: false, issues: [`${path} must be one of: ${allowedValues.join(', ')}.`] }
}

function stringValue(value: unknown, path: string): WaggleValidationResult<string> {
  if (typeof value !== 'string') {
    return { success: false, issues: [`${path} must be a string.`] }
  }

  return { success: true, value }
}

function booleanValue(value: unknown, path: string): WaggleValidationResult<boolean> {
  if (typeof value !== 'boolean') {
    return { success: false, issues: [`${path} must be a boolean.`] }
  }

  return { success: true, value }
}

function timestampValue(value: unknown, path: string): WaggleValidationResult<number> {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < MIN_TIMESTAMP) {
    return { success: false, issues: [`${path} must be a non-negative finite number.`] }
  }

  return { success: true, value }
}

function collectIssues(results: readonly WaggleValidationResult<unknown>[]) {
  return results.flatMap((result) => (result.success ? [] : result.issues))
}

export function isWaggleInheritedModel(model: string) {
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

function modelValue(value: unknown, path: string): WaggleValidationResult<string> {
  const model = stringValue(value, path)
  if (!model.success) return model

  if (isWaggleInheritedModel(model.value) || isProviderQualifiedWaggleModel(model.value)) {
    return model
  }

  return {
    success: false,
    issues: [`${path} must be ${WAGGLE_INHERIT_MODEL} or a provider/model id.`],
  }
}

function parseAgentSlot(value: unknown, path: string): WaggleValidationResult<WaggleAgentSlot> {
  if (!isRecord(value)) {
    return { success: false, issues: [`${path} must be an object.`] }
  }

  const label = stringValue(value.label, `${path}.label`)
  const model = modelValue(value.model, `${path}.model`)
  const roleDescription = stringValue(value.roleDescription, `${path}.roleDescription`)
  const color = literalValue(value.color, WAGGLE_AGENT_COLORS, `${path}.color`)
  const issues = collectIssues([label, model, roleDescription, color])
  if (
    issues.length > 0 ||
    !label.success ||
    !model.success ||
    !roleDescription.success ||
    !color.success
  ) {
    return { success: false, issues }
  }

  return {
    success: true,
    value: {
      label: label.value,
      model: model.value,
      roleDescription: roleDescription.value,
      color: color.value,
    },
  }
}

function parseMaxTurnsSafety(value: unknown): WaggleValidationResult<number> {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_WAGGLE_MAX_TURNS_SAFETY ||
    value > MAX_WAGGLE_MAX_TURNS_SAFETY
  ) {
    return {
      success: false,
      issues: [
        `stop.maxTurnsSafety must be an integer from ${String(MIN_WAGGLE_MAX_TURNS_SAFETY)} to ${String(MAX_WAGGLE_MAX_TURNS_SAFETY)}.`,
      ],
    }
  }

  return { success: true, value }
}

function parseStopConfig(value: unknown): WaggleValidationResult<WaggleStopConfig> {
  if (!isRecord(value)) {
    return { success: false, issues: ['stop must be an object.'] }
  }

  const primary = literalValue(value.primary, WAGGLE_STOP_CONDITIONS, 'stop.primary')
  const maxTurnsSafety = parseMaxTurnsSafety(value.maxTurnsSafety)
  const issues = collectIssues([primary, maxTurnsSafety])
  if (issues.length > 0 || !primary.success || !maxTurnsSafety.success) {
    return { success: false, issues }
  }

  return {
    success: true,
    value: {
      primary: primary.value,
      maxTurnsSafety: maxTurnsSafety.value,
    },
  }
}

function parseAgentTuple(
  value: unknown,
): WaggleValidationResult<readonly [WaggleAgentSlot, WaggleAgentSlot]> {
  if (!Array.isArray(value) || value.length !== WAGGLE_AGENT_COUNT) {
    return {
      success: false,
      issues: [`agents must contain exactly ${String(WAGGLE_AGENT_COUNT)} agent slots.`],
    }
  }

  const first = parseAgentSlot(value[FIRST_AGENT_INDEX], 'agents[0]')
  const second = parseAgentSlot(value[SECOND_AGENT_INDEX], 'agents[1]')
  const issues = collectIssues([first, second])
  if (issues.length > 0 || !first.success || !second.success) {
    return { success: false, issues }
  }

  return { success: true, value: [first.value, second.value] }
}

export function parseWaggleConfig(value: unknown): WaggleValidationResult<WaggleConfig> {
  if (!isRecord(value)) {
    return { success: false, issues: ['config must be an object.'] }
  }

  const mode = literalValue(value.mode, WAGGLE_COLLABORATION_MODES, 'mode')
  const agents = parseAgentTuple(value.agents)
  const stop = parseStopConfig(value.stop)
  const issues = collectIssues([mode, agents, stop])
  if (issues.length > 0 || !mode.success || !agents.success || !stop.success) {
    return { success: false, issues }
  }

  return {
    success: true,
    value: {
      mode: mode.value,
      agents: agents.value,
      stop: stop.value,
    },
  }
}

export function parseWagglePreset(value: unknown): WaggleValidationResult<WagglePreset> {
  if (!isRecord(value)) {
    return { success: false, issues: ['preset must be an object.'] }
  }

  const id = stringValue(value.id, 'id')
  const name = stringValue(value.name, 'name')
  const description = stringValue(value.description, 'description')
  const config = parseWaggleConfig(value.config)
  const isBuiltIn = booleanValue(value.isBuiltIn, 'isBuiltIn')
  const createdAt = timestampValue(value.createdAt, 'createdAt')
  const updatedAt = timestampValue(value.updatedAt, 'updatedAt')
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
    return { success: false, issues }
  }

  return {
    success: true,
    value: {
      id: id.value,
      name: name.value,
      description: description.value,
      config: config.value,
      isBuiltIn: isBuiltIn.value,
      createdAt: createdAt.value,
      updatedAt: updatedAt.value,
    },
  }
}
