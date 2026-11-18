import { Schema } from '@shared/schema'
import {
  isSessionInputJsonWithinLimit,
  isSessionInputTextWithinLimit,
  SESSION_INPUT_LIMITS,
} from '@shared/session-input-limits'

export const sessionInputIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(SESSION_INPUT_LIMITS.idLength),
)

export const sessionInputTextSchema = Schema.String.pipe(
  Schema.filter(
    (value) =>
      isSessionInputTextWithinLimit(value) ||
      `Session text exceeds ${String(SESSION_INPUT_LIMITS.persistedTextBytes)} UTF-8 bytes.`,
  ),
)

export const sessionInputItemTextSchema = Schema.String.pipe(
  Schema.maxLength(SESSION_INPUT_LIMITS.itemTextLength),
)

export const sessionInputPathSchema = Schema.String.pipe(
  Schema.maxLength(SESSION_INPUT_LIMITS.pathLength),
)

export const sessionInputJsonWithinLimit = (value: unknown) =>
  isSessionInputJsonWithinLimit(value) ||
  `Session JSON input exceeds ${String(SESSION_INPUT_LIMITS.jsonLength)} characters.`
