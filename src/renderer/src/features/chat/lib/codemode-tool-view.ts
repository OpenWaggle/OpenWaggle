import { match, P } from '@diegogbrisa/ts-match'
import type { JsonObject } from '@shared/types/json'
import { normalizeToolResultPayload } from '@shared/utils/tool-result-state'
import { isRecord } from '@shared/utils/validation'

const MODELS_CALL_PREFIX = 'models.'

/** The name of Pi's script tool. */
export const CODEMODE_TOOL_NAME = 'codemode'

export type CodemodeCallStatus = 'running' | 'ok' | 'error' | 'cancelled'

export interface CodemodeCallView {
  /** Stable React key: the call id plus its position, since running calls share `<id>/?`. */
  readonly key: string
  readonly name: string
  /** Compact JSON of the arguments, or the model a `models.*` call ran. */
  readonly args: string
  readonly status: CodemodeCallStatus
  readonly durationMs?: number
  readonly error?: string
  /** USD cost of a `models.*` call that reported usage. */
  readonly cost?: number
}

export interface CodemodeImageView {
  readonly key: string
  readonly src: string
  readonly mimeType: string
}

export interface CodemodeToolView {
  readonly script: string | null
  readonly output: string
  readonly images: readonly CodemodeImageView[]
  readonly calls: readonly CodemodeCallView[]
  /** Total USD cost of the script's model calls, when any reported one. */
  readonly modelCost?: number
  /** Whether Pi reported the script as failed. */
  readonly failed: boolean
  /** The `Script error:` text Pi appends to a failed script's output. */
  readonly error?: string
}

const SCRIPT_FAILED_HEADER = 'Script failed'
const SCRIPT_ERROR_PREFIX = 'Script error:\n'

/** The image types Pi's `image()` accepts; anything else is not drawn. */
const DRAWABLE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u

function callStatus(value: unknown): CodemodeCallStatus {
  return match(value)
    .with(P.union('running', 'ok', 'error', 'cancelled'), (status) => status)
    .otherwise(() => 'error' as const)
}

function optionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function withOptional<K extends string, V>(key: K, value: V | undefined) {
  return value === undefined ? {} : { [key]: value }
}

/** One row of codemode's own `details.calls` (CodemodeNestedCall). */
function detailsCall(value: unknown, index: number): CodemodeCallView | null {
  if (!isRecord(value) || typeof value.name !== 'string') return null
  return {
    key: `${String(value.id)}:${String(index)}`,
    name: value.name,
    args: typeof value.args === 'string' ? value.args : '',
    status: callStatus(value.status),
    ...withOptional('durationMs', optionalNumber(value.durationMs)),
    ...withOptional('error', optionalString(value.error)),
    ...withOptional('cost', optionalNumber(value.cost)),
  }
}

function rows(
  values: unknown,
  read: (value: unknown, index: number) => CodemodeCallView | null,
): CodemodeCallView[] {
  if (!Array.isArray(values)) return []
  return values.flatMap((value, index) => {
    const row = read(value, index)
    return row ? [row] : []
  })
}

/** Codemode's own `details.calls`, republished while the script runs and kept on its result. */
function callsOf(payload: Readonly<Record<string, unknown>>) {
  return isRecord(payload.details) ? rows(payload.details.calls, detailsCall) : []
}

/** Whether a call is one of the script's `models.*` calls, which no tool call event reports. */
export function isCodemodeModelCall(call: CodemodeCallView) {
  return call.name.startsWith(MODELS_CALL_PREFIX)
}

function contentBlocks(payload: Readonly<Record<string, unknown>>): readonly unknown[] {
  return Array.isArray(payload.content) ? payload.content : []
}

function drawableImage(block: unknown, index: number): CodemodeImageView | null {
  if (!isRecord(block) || block.type !== 'image') return null
  const { data, mimeType } = block
  if (typeof data !== 'string' || typeof mimeType !== 'string') return null
  if (!DRAWABLE_IMAGE_TYPES.has(mimeType) || !BASE64.test(data)) return null
  return { key: `image:${String(index)}`, src: `data:${mimeType};base64,${data}`, mimeType }
}

function imagesOf(blocks: readonly unknown[]) {
  return blocks.flatMap((block, index) => {
    const image = drawableImage(block, index)
    return image ? [image] : []
  })
}

function totalCost(calls: readonly CodemodeCallView[]) {
  const costs = calls.flatMap((call) => (call.cost === undefined ? [] : [call.cost]))
  return costs.length === 0 ? undefined : costs.reduce((sum, cost) => sum + cost, 0)
}

/**
 * What the codemode card shows for one call: its script, the script's output and images, and
 * the calls it made, from a live partial result, the final result, or a persisted one.
 */
export function codemodeToolView(args: JsonObject, result: unknown): CodemodeToolView {
  const payload = normalizeToolResultPayload(result)
  const record = isRecord(payload) ? payload : {}
  const blocks = contentBlocks(record)
  const calls = callsOf(record)
  const texts = blocks.flatMap((block) =>
    isRecord(block) && block.type === 'text' ? [String(block.text)] : [],
  )
  const errorBlock = [...texts].reverse().find((text) => text.startsWith(SCRIPT_ERROR_PREFIX))
  return {
    failed: texts[0]?.startsWith(SCRIPT_FAILED_HEADER) === true,
    ...withOptional('error', errorBlock?.slice(SCRIPT_ERROR_PREFIX.length)),
    script: typeof args.code === 'string' ? args.code : null,
    output: texts.join('\n'),
    images: imagesOf(blocks),
    calls,
    ...withOptional('modelCost', totalCost(calls)),
  }
}
