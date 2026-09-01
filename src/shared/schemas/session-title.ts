import { Schema } from '@shared/schema'
import {
  isNonBlankSessionTitle,
  SESSION_TITLE_MAX_LENGTH,
  SESSION_TITLE_MIN_LENGTH,
} from '@shared/session-title'

export const sessionTitleSchema = Schema.String.pipe(
  Schema.minLength(SESSION_TITLE_MIN_LENGTH),
  Schema.maxLength(SESSION_TITLE_MAX_LENGTH),
  Schema.filter((title) => isNonBlankSessionTitle(title) || 'Session title must not be blank.'),
)
