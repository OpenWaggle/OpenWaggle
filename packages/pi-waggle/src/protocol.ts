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

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
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
  if (!isRecord(value)) {
    return null
  }

  const runId = optionalString(value.runId)
  const turnNumber = nonNegativeInteger(value.turnNumber)
  const agentIndex = nonNegativeInteger(value.agentIndex)
  const agentLabel = optionalString(value.agentLabel)
  const agentModel = optionalString(value.agentModel)
  const agentColor = parseAgentColor(value.agentColor)

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
  if (!isRecord(value)) {
    return null
  }

  if (typeof value.enabled !== 'boolean') {
    return null
  }

  const updatedAt = nonNegativeTimestamp(value.updatedAt)
  if (updatedAt === undefined) {
    return null
  }

  const presetId = optionalString(value.presetId)
  const configResult = value.config === undefined ? undefined : parseWaggleConfig(value.config)
  if (configResult && !configResult.success) {
    return null
  }

  return {
    enabled: value.enabled,
    ...(presetId ? { presetId } : {}),
    ...(configResult?.success ? { config: configResult.value } : {}),
    updatedAt,
  }
}
