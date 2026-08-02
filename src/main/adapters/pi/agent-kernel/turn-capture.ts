import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { BYTES_PER_KIBIBYTE } from '@shared/constants/resource-limits'
import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { createLogger } from '../../../logger'
import {
  listTurnCheckpoints,
  pruneTurnCheckpoints,
  recordTurnCheckpoint,
} from '../../../store/turn-checkpoints'

const execFileAsync = promisify(execFile)
const logger = createLogger('turn-capture')
const MAX_CHECKPOINTS_PER_SESSION = 100
const DIFF_MAX_BUFFER = 50 * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE

/**
 * Best-effort per-turn checkpoint capture (WS7). Records the working-tree diff
 * produced at a turn boundary as a Turn checkpoint. Never throws: capture
 * failures must not affect the agent run.
 */
export async function captureTurnCheckpoint(input: {
  readonly session: SessionDetail
  readonly projectPath: string
  readonly runId: string
}): Promise<void> {
  try {
    const diff = await readWorkingTreeDiff(input.projectPath)
    if (!diff.trim()) return

    const sessionId = SessionId(String(input.session.id))
    const existing = await listTurnCheckpoints(sessionId)
    const turnIndex = existing.length

    await recordTurnCheckpoint({ sessionId, turnId: input.runId, turnIndex, diff })
    await pruneTurnCheckpoints(sessionId, MAX_CHECKPOINTS_PER_SESSION)
  } catch (error) {
    logger.warn('Failed to capture turn checkpoint', { error: String(error) })
  }
}

async function readWorkingTreeDiff(projectPath: string): Promise<string> {
  try {
    const head = await execFileAsync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: projectPath })
    if (head.stdout.trim()) {
      const result = await execFileAsync(
        'git',
        ['diff', '--patch', '--find-renames', '--no-ext-diff', 'HEAD'],
        { cwd: projectPath, maxBuffer: DIFF_MAX_BUFFER },
      )
      return result.stdout
    }
  } catch {
    // No HEAD yet (unborn branch) or not a repo — fall through to empty.
  }
  return ''
}
