import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isRecord } from '@shared/utils/validation'
import { ensurePrivateDirectory } from '../../utils/session-scratch-directory'

/**
 * The most text one hive result gives the model. One `items` call returned 596 KB (about 243k
 * tokens) before results were capped (C8 of the v1 performance research); Pi's MCP results stop
 * at 20 KB.
 */
export const HIVE_RESULT_TEXT_LIMIT_BYTES = 32 * 1024

/** Room kept for the truncation note itself. */
const TRUNCATION_NOTE_BYTES = 1_024
const RESULTS_DIRECTORY = 'hive-results'

/** Request bookkeeping the model never acts on. */
const ENVELOPE_KEYS = new Set(['contract', 'contractVersion', 'requestId', 'idempotencyKey'])
/** Transcript plumbing on every item: tree links and per-message usage. */
const ITEM_NOISE_KEYS = new Set(['branchHintId', 'parentNodeId'])
const METADATA_NOISE_KEYS = new Set(['usage', 'cost'])

function withoutKeys(value: Record<string, unknown>, keys: ReadonlySet<string>) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.has(key)))
}

function compactNode(value: unknown, key?: string): unknown {
  if (Array.isArray(value)) return value.map((entry) => compactNode(entry))
  if (!isRecord(value)) return value
  const kept = key === 'metadata' ? withoutKeys(value, METADATA_NOISE_KEYS) : value
  return Object.fromEntries(
    Object.entries(withoutKeys(kept, ITEM_NOISE_KEYS)).map(([name, entry]) => [
      name,
      compactNode(entry, name),
    ]),
  )
}

/**
 * What the model reads of a Session command result: the response without its envelope
 * (`contract`, `contractVersion`, `requestId`, `idempotencyKey`, a `replayed: false`), and items
 * without tree links or usage and cost metadata. `verbose: true` sends the whole result.
 */
export function compactHiveResult(result: unknown): unknown {
  if (!isRecord(result)) return result
  const response = isRecord(result.response) ? result.response : result
  const { replayed, ...kept } = withoutKeys(
    { ...withoutKeys(result, new Set(['response'])), ...response },
    ENVELOPE_KEYS,
  )
  return compactNode(
    replayed === false ? kept : { ...kept, ...(replayed === undefined ? {} : { replayed }) },
  )
}

function byteLength(text: string) {
  return Buffer.byteLength(text)
}

/** The outcome whose `items` are paged with `afterCreatedOrder`, when the result has one. */
function pagedOutcome(result: unknown) {
  if (!isRecord(result) || !isRecord(result.outcome)) return undefined
  const { outcome } = result
  return Array.isArray(outcome.items) ? { result, outcome, items: outcome.items } : undefined
}

function createdOrderOf(item: unknown) {
  return isRecord(item) && typeof item.createdOrder === 'number' ? item.createdOrder : undefined
}

/**
 * Keeps the leading items that fit and points the next page after the last one, the way the Host
 * pages them (`nextCreatedOrder` is the last returned item's `createdOrder`).
 */
function firstPageThatFits(result: unknown, note: Record<string, unknown>) {
  const paged = pagedOutcome(result)
  if (!paged) return undefined
  let low = 0
  let high = paged.items.length
  let best: string | undefined
  while (low <= high) {
    const count = Math.floor((low + high) / 2)
    const kept = paged.items.slice(0, count)
    const nextCreatedOrder = createdOrderOf(kept.at(-1))
    const text = JSON.stringify({
      ...paged.result,
      outcome: {
        ...paged.outcome,
        items: kept,
        ...(nextCreatedOrder === undefined ? {} : { nextCreatedOrder }),
      },
      truncated: { ...note, omittedItems: paged.items.length - count },
    })
    if (byteLength(text) <= HIVE_RESULT_TEXT_LIMIT_BYTES) {
      best = text
      low = count + 1
    } else {
      high = count - 1
    }
  }
  return best
}

async function savedFullResult(
  text: string,
  scratchDirectory: string | undefined,
  toolCallId: string,
) {
  if (!scratchDirectory) return undefined
  const directory = path.join(scratchDirectory, RESULTS_DIRECTORY)
  const file = path.join(directory, `${toolCallId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`)
  try {
    await ensurePrivateDirectory(directory)
    await writeFile(file, text, { mode: 0o600 })
    return file
  } catch {
    return undefined
  }
}

export interface HiveResultTextInput {
  readonly result: unknown
  readonly verbose: boolean
  readonly toolCallId: string
  /** The Session scratch directory, where an oversized result is saved whole. */
  readonly scratchDirectory?: string
}

/**
 * The model-facing text of a hive result, at most `HIVE_RESULT_TEXT_LIMIT_BYTES`. A larger one is
 * saved whole to the Session scratch directory; an `items` page keeps the items that fit with
 * `nextCreatedOrder` for the next call, anything else becomes a preview.
 */
export async function hiveResultText(input: HiveResultTextInput) {
  const projected = input.verbose ? input.result : compactHiveResult(input.result)
  const text = JSON.stringify(projected) ?? 'null'
  if (byteLength(text) <= HIVE_RESULT_TEXT_LIMIT_BYTES) return text
  const fullResult = await savedFullResult(
    JSON.stringify(input.result) ?? 'null',
    input.scratchDirectory,
    input.toolCallId,
  )
  const note = {
    bytes: byteLength(text),
    limitBytes: HIVE_RESULT_TEXT_LIMIT_BYTES,
    ...(fullResult ? { fullResult } : {}),
  }
  const page = firstPageThatFits(projected, {
    ...note,
    next: 'Continue with afterCreatedOrder set to outcome.nextCreatedOrder, or a smaller limit.',
  })
  if (page) return page
  return JSON.stringify({
    truncated: { ...note, next: 'Read fullResult, or narrow the call.' },
    preview: text.slice(0, HIVE_RESULT_TEXT_LIMIT_BYTES - TRUNCATION_NOTE_BYTES),
  })
}
