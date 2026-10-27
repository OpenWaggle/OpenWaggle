import type { SessionDetail } from '@shared/types/session'
import { formatErrorMessage } from '@shared/utils/node-error'
import { piSessionFileStillHasTail } from '../../../store/pi-session-file-tail'
import {
  type PiProjectionBase,
  readPiProjectionBase,
} from '../../../store/session-details/pi-projection-base'
import { logger } from './constants'

/**
 * The Session's current projection, for a Run's snapshot to keep the entries it already holds
 * (D6), when the Run's Pi file still has the bytes that projection was read from: the same first
 * bytes and the same last projected line at the same offset. A file `pi --resume` upgraded,
 * renamed entries in (ADR 0049) or another program rewrote fails that check, and the snapshot
 * projects every entry again, as before.
 */
export async function readRunProjectionBase(
  session: Pick<SessionDetail, 'id'>,
  piSessionFile: string | undefined,
): Promise<PiProjectionBase | null> {
  if (!piSessionFile) return null
  try {
    const base = await readPiProjectionBase(session.id)
    if (!base || !piSessionFileStillHasTail(piSessionFile, base.tail)) return null
    return base
  } catch (error) {
    // The base only saves work: without it the snapshot projects every entry.
    logger.warn('Could not read the projection a Run snapshot could keep', {
      sessionId: session.id,
      error: formatErrorMessage(error),
    })
    return null
  }
}
