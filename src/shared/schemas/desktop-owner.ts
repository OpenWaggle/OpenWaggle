import { Schema } from '../schema'
import { DESKTOP_FENCE_IDENTIFIER_LENGTH } from './desktop-fence'

const identifier = Schema.NonEmptyString.pipe(Schema.maxLength(DESKTOP_FENCE_IDENTIFIER_LENGTH))

export const desktopOwnerRecordSchema = Schema.Struct({
  guiInstanceId: identifier,
  hostInstanceId: identifier,
  state: Schema.Literal('active', 'closed'),
})
