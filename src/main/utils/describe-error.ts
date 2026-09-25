import * as Cause from 'effect/Cause'
import * as Runtime from 'effect/Runtime'

const MAX_CAUSE_DEPTH = 6

function readString(value: object, key: string) {
  const field: unknown = Reflect.get(value, key)
  return typeof field === 'string' && field.length > 0 ? field : null
}

/** The error an Effect `FiberFailure` wraps, which it does not expose as `cause`. */
function unwrapFiberFailure(error: unknown) {
  if (!Runtime.isFiberFailure(error)) return error
  return Cause.squash(error[Runtime.FiberFailureCauseId])
}

function describeOne(error: unknown) {
  if (typeof error !== 'object' || error === null) return String(error)
  const tag = readString(error, '_tag') ?? (error instanceof Error ? error.name : null)
  const message = readString(error, 'message')
  const operation = readString(error, 'operation')
  const code = readString(error, 'code')
  const label = [tag, operation ? `(${operation})` : null].filter(Boolean).join(' ')
  const detail = [code && code !== tag ? code : null, message].filter(Boolean).join(': ')
  return [label, detail].filter(Boolean).join(': ') || String(error)
}

/**
 * A human-readable description of an error and its cause chain.
 *
 * Tagged errors such as `SessionProjectionRepositoryError` carry an empty `message`, so reading
 * `error.message` alone produced empty log fields and a generic error card for a failed turn save
 * (ADR 0037). This keeps the tag, the repository operation, and every cause, including the one an
 * Effect `FiberFailure` hides behind a symbol.
 */
export function describeError(error: unknown): string {
  if (error === undefined || error === null) return String(error)
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  for (
    let depth = 0;
    depth < MAX_CAUSE_DEPTH && current !== undefined && current !== null;
    depth += 1
  ) {
    const unwrapped = unwrapFiberFailure(current)
    if (seen.has(unwrapped)) break
    seen.add(unwrapped)
    parts.push(describeOne(unwrapped))
    current =
      typeof unwrapped === 'object' && unwrapped !== null
        ? Reflect.get(unwrapped, 'cause')
        : undefined
  }
  return parts.join(' <- ')
}
