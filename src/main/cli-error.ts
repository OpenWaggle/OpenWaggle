import {
  SESSION_HOST_ERROR_KINDS,
  type SessionHostErrorKind,
} from '@shared/domain/session-host-refusals'

/**
 * Every OpenWaggle CLI error has one of these kinds, each with its own exit code (#351). The
 * kind comes from the error's type, from the phase that raised it, or from the Session Host's
 * refusal (ADR 0063), never from its message, so rewording a message cannot change an exit code.
 * `docs` and `--json` envelopes name the kind.
 */
export const CLI_ERROR_KINDS = SESSION_HOST_ERROR_KINDS

export type CliErrorKind = SessionHostErrorKind

export const CLI_EXIT = {
  SUCCESS: 0,
  FAILURE: 1,
  USAGE: 2,
  AUTHENTICATION: 3,
  AUTHORIZATION: 4,
  NOT_FOUND: 5,
  CONFLICT: 6,
  TIMEOUT: 7,
  HOST_UNAVAILABLE: 8,
  RESYNC_REQUIRED: 9,
} as const

const EXIT_CODE_OF_KIND: Readonly<Record<CliErrorKind, number>> = {
  usage: CLI_EXIT.USAGE,
  authentication: CLI_EXIT.AUTHENTICATION,
  authorization: CLI_EXIT.AUTHORIZATION,
  not_found: CLI_EXIT.NOT_FOUND,
  conflict: CLI_EXIT.CONFLICT,
  timeout: CLI_EXIT.TIMEOUT,
  host_unavailable: CLI_EXIT.HOST_UNAVAILABLE,
  resync_required: CLI_EXIT.RESYNC_REQUIRED,
  internal: CLI_EXIT.FAILURE,
}

export function cliExitCodeForKind(kind: CliErrorKind) {
  return EXIT_CODE_OF_KIND[kind]
}

/** An error whose CLI kind is known where it is raised. */
export class CliError extends Error {
  override readonly name: string = 'CliError'
  readonly code: string | undefined

  readonly kind: CliErrorKind

  constructor(
    kind: CliErrorKind,
    message: string,
    options?: ErrorOptions & {
      /** The Session Host's refusal code, when one caused the error; `--json` carries it. */
      readonly code?: string
    },
  ) {
    super(message, options)
    this.kind = kind
    this.code = options?.code
  }
}

/**
 * Runs the part of a command that only reads its arguments: what it rejects is a usage error,
 * whatever it throws, unless the error already says its kind.
 */
export async function asUsageErrors<T>(read: () => T | Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    throw usageErrorFrom(error)
  }
}

/** The synchronous form of `asUsageErrors`. */
export function asUsageErrorsSync<T>(read: () => T): T {
  try {
    return read()
  } catch (error) {
    throw usageErrorFrom(error)
  }
}

function usageErrorFrom(error: unknown) {
  if (error instanceof CliError) return error
  return new CliError('usage', error instanceof Error ? error.message : String(error), {
    cause: error,
  })
}
