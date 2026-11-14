import { decodeUnknownExactOrThrow, Schema } from '@shared/schema'
import { LOCAL_HOST_CONTRACT_VERSION } from '@shared/types/local-host'

const nonNegativeIntegerSchema = Schema.Number.pipe(Schema.int(), Schema.nonNegative())

/** Ask the Session Host to stop: it accepts no new work and exits once its active work ends. */
export const localHostRequestSchema = Schema.Struct({
  contractVersion: Schema.Literal(LOCAL_HOST_CONTRACT_VERSION),
  operation: Schema.Literal('stop'),
  /**
   * `update`: the stop that installing an update sends, from the desktop app, `openwaggle update`
   * or the install script (ADR 0047). It has a deadline and answers with the Host's process id.
   */
  purpose: Schema.optionalWith(Schema.Literal('update'), { exact: true }),
})

export const localHostResponseSchema = Schema.Struct({
  contractVersion: Schema.Literal(LOCAL_HOST_CONTRACT_VERSION),
  operation: Schema.Literal('stop'),
  hostInstanceId: Schema.String,
  /** Runs the Host waits for before it exits; `null` when it could not count them. */
  blockingRuns: Schema.NullOr(nonNegativeIntegerSchema),
  /** Running Actions, such as dev servers, the Host also waits for. */
  blockingActions: nonNegativeIntegerSchema,
  /**
   * The Host's process id, sent only for an update stop, so the installer can wait for that
   * process to exit (ADR 0047).
   */
  processId: Schema.optionalWith(Schema.Number.pipe(Schema.int(), Schema.positive()), {
    exact: true,
  }),
})

export function decodeLocalHostResponse(value: unknown) {
  return decodeUnknownExactOrThrow(localHostResponseSchema, value)
}
