import { Buffer } from 'node:buffer'
import path from 'node:path'
import { TERMINAL } from '@shared/constants/resource-limits'
import { Schema } from '@shared/schema'
import { terminalEnvironmentSchema, terminalInputIncarnationSchema } from '@shared/schemas/terminal'
import { TERMINAL_KEY_SEPARATOR } from '@shared/types/terminal'

const terminalIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(TERMINAL.TERMINAL_ID_MAX_LENGTH),
  Schema.filter((value) => !value.includes(TERMINAL_KEY_SEPARATOR), {
    message: () => `Terminal ids cannot contain "${TERMINAL_KEY_SEPARATOR}".`,
  }),
)

const terminalOwnerKeySchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(TERMINAL.OWNER_KEY_MAX_LENGTH),
)

const terminalDimensionsSchema = {
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

export const terminalOpenInputSchema = Schema.Struct({
  ownerKey: terminalOwnerKeySchema,
  terminalId: terminalIdSchema,
  cwd: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(TERMINAL.CWD_PATH_MAX_LENGTH),
    Schema.filter((value) => path.isAbsolute(value) || 'Terminal Working path must be absolute.'),
  ),
  ...terminalDimensionsSchema,
  env: Schema.optional(terminalEnvironmentSchema),
  inputGeneration: Schema.optional(
    Schema.String.pipe(Schema.minLength(1), Schema.maxLength(TERMINAL.INPUT_GENERATION_MAX_LENGTH)),
  ),
})

export const terminalResizeSchema = Schema.Struct({
  ownerKey: terminalOwnerKeySchema,
  terminalId: terminalIdSchema,
  ...terminalDimensionsSchema,
})

export const terminalOwnerSchema = Schema.Struct({
  ownerKey: terminalOwnerKeySchema,
  terminalId: terminalIdSchema,
})

export const terminalInputReleaseSchema = Schema.Struct({
  ownerKey: terminalOwnerKeySchema,
  terminalId: terminalIdSchema,
  incarnation: Schema.optional(terminalInputIncarnationSchema),
})

export const terminalOwnerMigrationSchema = Schema.Struct({
  fromOwnerKey: terminalOwnerKeySchema,
  toOwnerKey: terminalOwnerKeySchema,
})

export const terminalOutputAckSchema = Schema.Struct({
  ownerKey: terminalOwnerKeySchema,
  terminalId: terminalIdSchema,
  outputGeneration: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  endOffset: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
})

export const terminalWriteSchema = Schema.String.pipe(
  Schema.maxLength(TERMINAL.MAX_PROJECT_ACTION_INPUT_BYTES),
  Schema.filter(
    (data) => Buffer.byteLength(data, 'utf8') <= TERMINAL.MAX_PROJECT_ACTION_INPUT_BYTES,
    {
      message: () => 'Terminal input exceeds the byte limit.',
    },
  ),
)

export const terminalInputIdentitySchema = Schema.Struct({
  incarnation: Schema.optional(terminalInputIncarnationSchema),
  generation: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(TERMINAL.INPUT_GENERATION_MAX_LENGTH),
  ),
  sequence: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(0),
    Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  ),
})

export const terminalInputIntentSchema = Schema.Struct({
  kind: Schema.Literal('project-action'),
  executionId: Schema.String.pipe(
    Schema.minLength(1),
    Schema.maxLength(TERMINAL.INPUT_GENERATION_MAX_LENGTH),
  ),
})
