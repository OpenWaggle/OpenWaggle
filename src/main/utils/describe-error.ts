import os from 'node:os'
import * as Cause from 'effect/Cause'
import * as Runtime from 'effect/Runtime'
import { redactSensitiveText } from './redact'

const MAX_CAUSE_DEPTH = 6

function readString(value: object, key: string) {
  const field: unknown = Reflect.get(value, key)
  return typeof field === 'string' && field.length > 0 ? field : null
}

/** The error an Effect `FiberFailure` wraps, which it does not expose as `cause`. */
export function unwrapFiberFailure(error: unknown) {
  if (!Runtime.isFiberFailure(error)) return error
  return Cause.squash(error[Runtime.FiberFailureCauseId])
}

/** How a cause that is a bare object, such as `{ projectPath }` context, is rendered. */
type PlainObjectRendering = 'json' | 'omit'

function plainObjectJson(value: object) {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return ''
  }
}

function describeOne(error: unknown, plainObjects: PlainObjectRendering) {
  if (typeof error !== 'object' || error === null) return String(error)
  const tag = readString(error, '_tag') ?? (error instanceof Error ? error.name : null)
  const message = readString(error, 'message')
  const operation = readString(error, 'operation')
  const code = readString(error, 'code')
  const label = [tag, operation ? `(${operation})` : null].filter(Boolean).join(' ')
  const detail = [code && code !== tag ? code : null, message].filter(Boolean).join(': ')
  const description = [label, detail].filter(Boolean).join(': ')
  if (description) return description
  if (error instanceof Error) return String(error)
  // "[object Object]" says nothing. Logs keep the context; text for callers leaves it out.
  return plainObjects === 'json' ? plainObjectJson(error) : ''
}

/**
 * A human-readable description of an error and its cause chain.
 *
 * Tagged errors such as `SessionProjectionRepositoryError` carry an empty `message`, so reading
 * `error.message` alone produced empty log fields and a generic error card for a failed turn save
 * (ADR 0037). This keeps the tag, the repository operation, and every cause, including the one an
 * Effect `FiberFailure` hides behind a symbol. Bare-object causes are rendered as JSON for the
 * Host log; pass `plainObjects: 'omit'` for text that leaves the Host.
 */
export function describeError(
  error: unknown,
  options: { readonly plainObjects?: PlainObjectRendering } = {},
): string {
  if (error === undefined || error === null) return String(error)
  const plainObjects = options.plainObjects ?? 'json'
  const described = errorCauseChain(error)
    .map((entry) => describeOne(entry, plainObjects))
    .filter(Boolean)
    .join(' <- ')
  return described || String(error)
}

/** The error and each of its causes, outermost first, unwrapping Effect `FiberFailure`s. */
export function errorCauseChain(error: unknown): unknown[] {
  const chain: unknown[] = []
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
    chain.push(unwrapped)
    current =
      typeof unwrapped === 'object' && unwrapped !== null
        ? Reflect.get(unwrapped, 'cause')
        : undefined
  }
  return chain
}

const MAX_USER_FACING_DETAIL_LENGTH = 600

/**
 * Error detail that is safe to publish beyond the Host log: to the renderer, the CLI, and
 * feedback reports.
 *
 * Secrets are redacted, the home directory is abbreviated, and the text is bounded. The full,
 * unredacted cause stays in the Host log only.
 */
export function userFacingErrorDetail(detail: string) {
  const home = os.homedir()
  const redacted = redactSensitiveText(home ? detail.split(home).join('~') : detail)
  return redacted.length > MAX_USER_FACING_DETAIL_LENGTH
    ? `${redacted.slice(0, MAX_USER_FACING_DETAIL_LENGTH)}…`
    : redacted
}
