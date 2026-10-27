import type { SessionId } from '@shared/types/brand'
import type { PiSessionFilesShape, PiSessionProjectionState } from '../ports/pi-session-discovery'

/**
 * What a refresh reads a changed Pi file with: the projection's entries, so a file that holds
 * only them is kept, and its recorded tail, so a file that only grew is read from there (D6).
 */
export function snapshotReadInput(
  sessionId: SessionId,
  state: PiSessionProjectionState,
  piSessionFile: string,
  cwd: string,
): Parameters<PiSessionFilesShape['readSnapshot']>[0] {
  return {
    piSessionFile,
    cwd,
    ...(state.piEntryNodeIdPrefix ? { piEntryNodeIdPrefix: state.piEntryNodeIdPrefix } : {}),
    projectedPiEntryCount: state.projectedPiEntryCount,
    projectedNodeIds: state.projectedNodeIds,
    projectedTail: state.projectedTail,
    sessionId,
  }
}
