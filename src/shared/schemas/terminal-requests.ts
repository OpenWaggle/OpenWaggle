/**
 * The request objects the window passes to the `terminal:*` IPC channels. Each schema is the one
 * source of its payload: `@shared/types/terminal` exports the inferred types, and the main
 * handlers decode with these schemas (adding the checks only Node can make).
 */
import { TERMINAL } from '@shared/constants/resource-limits'
import { Schema } from '@shared/schema'
import { TERMINAL_KEY_SEPARATOR } from '@shared/types/terminal'
import { terminalEnvironmentSchema, terminalInputIncarnationSchema } from './terminal'

export const terminalIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(TERMINAL.TERMINAL_ID_MAX_LENGTH),
  Schema.filter((value) => !value.includes(TERMINAL_KEY_SEPARATOR), {
    message: () => `Terminal ids cannot contain "${TERMINAL_KEY_SEPARATOR}".`,
  }),
)

export const terminalOwnerKeySchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(TERMINAL.OWNER_KEY_MAX_LENGTH),
)

export const terminalDimensionFields = {
  cols: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(TERMINAL.MIN_COLS),
    Schema.lessThanOrEqualTo(TERMINAL.MAX_COLS),
  ),
  rows: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(TERMINAL.MIN_ROWS),
    Schema.lessThanOrEqualTo(TERMINAL.MAX_ROWS),
  ),
}

const terminalInputGenerationSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(TERMINAL.INPUT_GENERATION_MAX_LENGTH),
)

/** Input that (re)opens a terminal. Idempotent: same launch context reuses the live shell. */
export const terminalOpenInputSchema = Schema.Struct({
  ownerKey: terminalOwnerKeySchema,
  terminalId: terminalIdSchema,
  /** Absolute working path the shell starts in — the owner's Working path. */
  cwd: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(TERMINAL.CWD_PATH_MAX_LENGTH)),
  ...terminalDimensionFields,
  /**
   * Explicit launch environment layered over a fresh inferred user shell
   * environment. Omission preserves a terminal record's current overrides;
   * an object, including `{}`, is a new launch context.
   */
  env: Schema.optional(terminalEnvironmentSchema),
  /**
   * Renderer-runtime nonce for the ordered input stream. Re-attaches with a
   * new nonce revoke late writes from an older renderer while restarts keep
   * the same nonce and therefore preserve accepted startup input.
   */
  inputGeneration: Schema.optional(terminalInputGenerationSchema),
})

/** Idempotency identity for one ordered renderer-to-terminal input chunk. */
export const terminalInputIdentitySchema = Schema.Struct({
  generation: terminalInputGenerationSchema,
  sequence: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(0),
    Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  ),
  /** Native record identity from attach; prevents late writes reaching a recreated terminal. */
  incarnation: Schema.optional(terminalInputIncarnationSchema),
})

/** Semantic intent carried with an ordered input item when it needs main-process arbitration. */
export const terminalInputIntentSchema = Schema.Struct({
  kind: Schema.Literal('project-action'),
  /** Unique logical execution id; retries must retain this exact value. */
  executionId: terminalInputGenerationSchema,
})
