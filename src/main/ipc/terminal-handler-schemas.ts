import { Buffer } from 'node:buffer'
import path from 'node:path'
import { TERMINAL } from '@shared/constants/resource-limits'
import { Schema } from '@shared/schema'
import { terminalInputIncarnationSchema } from '@shared/schemas/terminal'
import {
  terminalOpenInputSchema as sharedTerminalOpenInputSchema,
  terminalDimensionFields,
  terminalIdSchema,
  terminalOwnerKeySchema,
} from '@shared/schemas/terminal-requests'

/** The shared open input, with the absolute Working path only Node can check here. */
export const terminalOpenInputSchema = sharedTerminalOpenInputSchema.pipe(
  Schema.filter(
    (input) =>
      path.isAbsolute(input.cwd) || {
        path: ['cwd'],
        message: 'Terminal Working path must be absolute.',
      },
  ),
)

export const terminalResizeSchema = Schema.Struct({
  ownerKey: terminalOwnerKeySchema,
  terminalId: terminalIdSchema,
  ...terminalDimensionFields,
})

export const terminalOwnerSchema = Schema.Struct({
  ownerKey: terminalOwnerKeySchema,
  terminalId: terminalIdSchema,
})

export const terminalCloseSchema = Schema.Struct({
  ownerKey: terminalOwnerKeySchema,
  terminalId: terminalIdSchema,
  deleteHistory: Schema.Boolean,
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
