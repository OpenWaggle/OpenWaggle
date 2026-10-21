/**
 * What a run or a worktree removal says when a worktree fails its saved-preparation check. The
 * error classifier recognises these headlines and shows the message from {@link
 * WORKTREE_PREPARATION_PROBLEM} on, so a path that looks like another error is not misread.
 */
export const WORKTREE_PREPARATION_PROBLEM = 'This worktree '

export type WorktreePreparationVerdict = 'no longer matches' | 'cannot be checked against'

const VERDICTS: readonly WorktreePreparationVerdict[] = [
  'no longer matches',
  'cannot be checked against',
]

/** "This worktree <verdict> its saved preparation", the start of a run's error. */
export function worktreePreparationHeadline(verdict: WorktreePreparationVerdict) {
  return `${WORKTREE_PREPARATION_PROBLEM}${verdict} its saved preparation`
}

/** Whether an error message is a worktree's failed saved-preparation check. */
export function isWorktreePreparationMessage(lowerMessage: string) {
  return VERDICTS.some((verdict) =>
    lowerMessage.includes(worktreePreparationHeadline(verdict).toLowerCase()),
  )
}
