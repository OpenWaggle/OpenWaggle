import * as Cause from 'effect/Cause'
import * as Option from 'effect/Option'
import * as Runtime from 'effect/Runtime'

const MAX_ERROR_CAUSE_DEPTH = 4

/** The GUI may already have performed this action. Never automatically replay it. */
export class DesktopOperationIndeterminateError extends Error {
  readonly code = 'desktop_operation_indeterminate'

  constructor(options?: ErrorOptions) {
    super(
      'The desktop action could not be confirmed after dispatch. It may have completed; it was not retried.',
      options,
    )
    this.name = 'DesktopOperationIndeterminateError'
  }
}

export function desktopUnavailableError() {
  return new Error(
    'An attached OpenWaggle desktop is required for this operation. Open or reconnect the desktop and retry.',
  )
}

export function isIndeterminateDesktopOperation(error: unknown, depth = 0): boolean {
  if (error instanceof DesktopOperationIndeterminateError) return true
  if (depth >= MAX_ERROR_CAUSE_DEPTH) return false
  if (Runtime.isFiberFailure(error)) {
    return isIndeterminateDesktopOperation(
      Option.getOrUndefined(Cause.failureOption(error[Runtime.FiberFailureCauseId])),
      depth + 1,
    )
  }
  if (
    error instanceof AggregateError &&
    error.errors.some((nested: unknown) => isIndeterminateDesktopOperation(nested, depth + 1))
  )
    return true
  return error instanceof Error && isIndeterminateDesktopOperation(error.cause, depth + 1)
}
