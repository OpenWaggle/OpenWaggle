import type { SessionDetail } from '@shared/types/session'
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import { PiSessionFiles } from '../ports/pi-session-discovery'
import { hasAnyActiveRun } from './active-session-runs'

/**
 * Marks a Session read for the chat view whose Pi file's latest prompt came from outside
 * OpenWaggle, such as the `pi` CLI, so the composer asks whether to continue it here or keep
 * running it in pi before it sends (ADR 0051). Nothing locks the file between the two programs.
 * A Session with a Run is skipped: what the composer sends then waits behind the Run.
 */
export function withPiSessionPromptOrigin(detail: SessionDetail | null) {
  if (!detail?.piSessionFile || detail.piSessionFileDeleted) return Effect.succeed(detail)
  const file = detail.piSessionFile
  return Effect.gen(function* () {
    if (hasAnyActiveRun(detail.id)) return detail
    const files = yield* Effect.serviceOption(PiSessionFiles)
    if (Option.isNone(files)) return detail
    const origin = yield* files.value.lastPromptOrigin(file)
    return origin === 'outside' ? { ...detail, piSessionLastPromptOutside: true as const } : detail
  })
}
