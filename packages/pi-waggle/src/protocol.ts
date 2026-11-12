import {
  parseWaggleConfig,
  WAGGLE_AGENT_COLORS,
  type WaggleAgentColor,
  type WaggleConfig,
} from '@openwaggle/waggle-core'

const MIN_INDEX = 0
const MIN_UPDATED_AT = 0

export const PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE = 'pi-waggle.user-request'
export const PI_WAGGLE_TURN_CUSTOM_TYPE = 'pi-waggle.turn'
export const PI_WAGGLE_MODE_STATE_CUSTOM_TYPE = 'pi-waggle.mode-state'

export interface PiWaggleTurnDetails {
  readonly runId: string
  readonly turnNumber: number
  readonly agentIndex: number
  readonly agentLabel: string
  readonly agentModel: string
  readonly agentColor: WaggleAgentColor
}

export interface PiWaggleModeState {
  readonly enabled: boolean
  readonly presetId?: string
  readonly config?: WaggleConfig
  readonly updatedAt: number
}

/** The declared fields of `T`, each still unchecked: what a parser reads before it validates. */
type UncheckedFields<T> = { readonly [K in keyof T]?: unknown }

function isObjectValue(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function nonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_INDEX
    ? value
    : undefined
}

function nonNegativeTimestamp(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_UPDATED_AT
    ? value
    : undefined
}

function parseAgentColor(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  for (const color of WAGGLE_AGENT_COLORS) {
    if (value === color) {
      return color
    }
  }

  return undefined
}

export function createPiWaggleTurnDetails(input: PiWaggleTurnDetails): PiWaggleTurnDetails {
  return input
}

export function parsePiWaggleTurnDetails(value: unknown): PiWaggleTurnDetails | null {
  if (!isObjectValue(value)) {
    return null
  }

  const fields: UncheckedFields<PiWaggleTurnDetails> = value
  const runId = optionalString(fields.runId)
  const turnNumber = nonNegativeInteger(fields.turnNumber)
  const agentIndex = nonNegativeInteger(fields.agentIndex)
  const agentLabel = optionalString(fields.agentLabel)
  const agentModel = optionalString(fields.agentModel)
  const agentColor = parseAgentColor(fields.agentColor)

  if (
    !runId ||
    turnNumber === undefined ||
    agentIndex === undefined ||
    !agentLabel ||
    !agentModel ||
    !agentColor
  ) {
    return null
  }

  return { runId, turnNumber, agentIndex, agentLabel, agentModel, agentColor }
}

export function createPiWaggleModeState(input: PiWaggleModeState): PiWaggleModeState {
  return input
}

export function parsePiWaggleModeState(value: unknown): PiWaggleModeState | null {
  if (!isObjectValue(value)) {
    return null
  }

  const fields: UncheckedFields<PiWaggleModeState> = value
  if (typeof fields.enabled !== 'boolean') {
    return null
  }

  const updatedAt = nonNegativeTimestamp(fields.updatedAt)
  if (updatedAt === undefined) {
    return null
  }

  const presetId = optionalString(fields.presetId)
  const configResult = fields.config === undefined ? undefined : parseWaggleConfig(fields.config)
  if (configResult && !configResult.success) {
    return null
  }

  return {
    enabled: fields.enabled,
    ...(presetId ? { presetId } : {}),
    ...(configResult?.success ? { config: configResult.value } : {}),
    updatedAt,
  }
}
