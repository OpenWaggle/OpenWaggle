import { Context, type Effect } from 'effect'
import type { ValidatedSessionResourceImage } from '../domain/session-resource-image'

export interface SessionResourceImageValidatorShape {
  readonly validate: (
    bytes: Uint8Array,
    mimeType: string,
  ) => Effect.Effect<ValidatedSessionResourceImage | null>
}

export class SessionResourceImageValidator extends Context.Tag(
  '@openwaggle/SessionResourceImageValidator',
)<SessionResourceImageValidator, SessionResourceImageValidatorShape>() {}
