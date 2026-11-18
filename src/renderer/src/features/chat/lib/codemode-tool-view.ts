import { match, P } from '@diegogbrisa/ts-match'
import type { JsonObject } from '@shared/types/json'
import { normalizeToolResultPayload } from '@shared/utils/tool-result-state'
import type { UncheckedFields } from '@shared/types/unchecked-fields'
import { isObjectValue } from '@shared/utils/object-shape'

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

function callStatus(value: unknown) {
  const result: CodemodeCallStatus = match(value)
    .with(P.union('running', 'ok', 'error', 'cancelled'), (status) => status)
    .otherwise(() => 'error' as const)
  return result
}

function optionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function withOptional<V>(key: string, value: V | undefined) {
  return value === undefined ? {} : { [key]: value }
}

/** Codemode's own nested call record (CodemodeNestedCall), as far as the card reads it. */
interface CodemodeNestedCall {
  readonly id: string
  readonly name: string
  readonly args: string
  readonly status: CodemodeCallStatus
  readonly durationMs: number
  readonly error: string
  readonly cost: number
}

/** Codemode's tool result, as far as the card reads it. */
interface CodemodeResultPayload {
  readonly details: { readonly calls: readonly CodemodeNestedCall[] }
  readonly content: readonly unknown[]
}

interface CodemodeContentBlock {
  readonly type: 'text' | 'image'
  readonly text: string
  readonly data: string
  readonly mimeType: string
}

function unchecked<T>(value: unknown) {
  const fields: UncheckedFields<T> = isObjectValue(value) ? value : {}
  return fields
}

/** One row of codemode's own `details.calls` (CodemodeNestedCall). */
function detailsCall(value: unknown, index: number) {
  const call = unchecked<CodemodeNestedCall>(value)
  if (typeof call.name !== 'string') return null
  const view: CodemodeCallView | null = {
    key: `${String(call.id)}:${String(index)}`,
    name: call.name,
    args: typeof call.args === 'string' ? call.args : '',
    status: callStatus(call.status),
    ...withOptional('durationMs', optionalNumber(call.durationMs)),
    ...withOptional('error', optionalString(call.error)),
    ...withOptional('cost', optionalNumber(call.cost)),
  }
  return view
}

function rows(values: unknown, read: (value: unknown, index: number) => CodemodeCallView | null) {
  if (!Array.isArray(values)) {
    const view: CodemodeCallView[] = []
    return view
  }
  const view: CodemodeCallView[] = values.flatMap((value, index) => {
    const row = read(value, index)
    return row ? [row] : []
  })
  return view
}

/** Codemode's own `details.calls`, republished while the script runs and kept on its result. */
function callsOf(payload: UncheckedFields<CodemodeResultPayload>) {
  return rows(unchecked<CodemodeResultPayload['details']>(payload.details).calls, detailsCall)
}

/** Whether a call is one of the script's `models.*` calls, which no tool call event reports. */
export function isCodemodeModelCall(call: CodemodeCallView) {
  return call.name.startsWith(MODELS_CALL_PREFIX)
}

function contentBlocks(payload: UncheckedFields<CodemodeResultPayload>) {
  const result: readonly unknown[] = Array.isArray(payload.content) ? payload.content : []
  return result
}

function drawableImage(block: unknown, index: number) {
  const { type, data, mimeType } = unchecked<CodemodeContentBlock>(block)
  if (type !== 'image') return null
  if (typeof data !== 'string' || typeof mimeType !== 'string') return null
  if (!DRAWABLE_IMAGE_TYPES.has(mimeType) || !BASE64.test(data)) return null
  const view: CodemodeImageView | null = {
    key: `image:${String(index)}`,
    src: `data:${mimeType};base64,${data}`,
    mimeType,
  }
  return view
}

function imagesOf(blocks: readonly unknown[]) {
  return blocks.flatMap((block, index) => {
    const image = drawableImage(block, index)
    return image ? [image] : []
  })
}

function codemodeArgs(args: JsonObject) {
  const fields: UncheckedFields<{ readonly code: string }> = args
  return fields
}

function totalCost(calls: readonly CodemodeCallView[]) {
  const costs = calls.flatMap((call) => (call.cost === undefined ? [] : [call.cost]))
  return costs.length === 0 ? undefined : costs.reduce((sum, cost) => sum + cost, 0)
}

/**
 * What the codemode card shows for one call: its script, the script's output and images, and
 * the calls it made, from a live partial result, the final result, or a persisted one.
 */
export function codemodeToolView(args: JsonObject, result: unknown) {
  const payload = normalizeToolResultPayload(result)
  const record = unchecked<CodemodeResultPayload>(payload)
  const blocks = contentBlocks(record)
  const calls = callsOf(record)
  const texts = blocks.flatMap((block) => {
    const { type, text } = unchecked<CodemodeContentBlock>(block)
    return type === 'text' ? [String(text)] : []
  })
  const { code } = codemodeArgs(args)
  const errorBlock = [...texts].reverse().find((text) => text.startsWith(SCRIPT_ERROR_PREFIX))
  const view: CodemodeToolView = {
    failed: texts[0]?.startsWith(SCRIPT_FAILED_HEADER) === true,
    ...withOptional('error', errorBlock?.slice(SCRIPT_ERROR_PREFIX.length)),
    script: typeof code === 'string' ? code : null,
    // The card shows the error on its own, so the output leaves it out.
    output: texts.filter((text) => text !== errorBlock).join('\n'),
    images: imagesOf(blocks),
    calls,
    ...withOptional('modelCost', totalCost(calls)),
  }
  return view
}
