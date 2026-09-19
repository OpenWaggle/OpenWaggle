import type { AgentSendPayload } from '@shared/types/agent'
import * as Effect from 'effect/Effect'
import { SessionResourceImageValidator } from '../ports/session-resource-image-validator'
import type {
  SessionResourceStoreShape,
  StoredSessionResourceFile,
} from '../ports/session-resource-store'

export function classifyStoredAttachment(
  attachment: AgentSendPayload['attachments'][number],
  stored: StoredSessionResourceFile,
  store: SessionResourceStoreShape,
) {
  if (attachment.kind !== 'image') return Effect.succeed('file' as const)
  return Effect.gen(function* () {
    const validator = yield* SessionResourceImageValidator
    const bytes = yield* store.read(stored.path)
    return (yield* validator.validate(bytes, attachment.mimeType))
      ? ('image' as const)
      : ('file' as const)
  }).pipe(Effect.catchAll(() => Effect.succeed('file' as const)))
}
