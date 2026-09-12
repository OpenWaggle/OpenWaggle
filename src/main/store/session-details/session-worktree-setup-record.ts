import { match } from '@diegogbrisa/ts-match'

export interface SessionWorktreeSetupRow {
  readonly worktree_path: string
  readonly generation: string
  readonly dispatch_state: string
  readonly claim_token: string | null
  readonly accepted_at: number | null
}

export interface PendingSessionWorktreeSetup {
  readonly worktreePath: string
  readonly generation: string
  readonly state: 'pending'
}

export interface ClaimedSessionWorktreeSetup {
  readonly worktreePath: string
  readonly generation: string
  readonly state: 'claimed'
  readonly claimToken: string
}

export interface AcceptedSessionWorktreeSetup {
  readonly worktreePath: string
  readonly generation: string
  readonly state: 'accepted'
  readonly claimToken: string
  readonly acceptedAt: number
}

export type SessionWorktreeSetupDispatch =
  | PendingSessionWorktreeSetup
  | ClaimedSessionWorktreeSetup
  | AcceptedSessionWorktreeSetup

function invalidDispatchRow(row: SessionWorktreeSetupRow): never {
  throw new Error(
    `Invalid Session worktree Setup dispatch state for generation ${row.generation}: ${row.dispatch_state}`,
  )
}

export function hydrateSetupDispatch(
  row: SessionWorktreeSetupRow | undefined,
): SessionWorktreeSetupDispatch | null {
  if (!row) return null
  const base = { worktreePath: row.worktree_path, generation: row.generation }
  return match(row.dispatch_state)
    .with('pending', () => {
      if (row.claim_token !== null || row.accepted_at !== null) return invalidDispatchRow(row)
      return { ...base, state: 'pending' as const }
    })
    .with('claimed', () => {
      if (!row.claim_token || row.accepted_at !== null) return invalidDispatchRow(row)
      return { ...base, state: 'claimed' as const, claimToken: row.claim_token }
    })
    .with('accepted', () => {
      if (!row.claim_token || row.accepted_at === null) return invalidDispatchRow(row)
      return {
        ...base,
        state: 'accepted' as const,
        claimToken: row.claim_token,
        acceptedAt: row.accepted_at,
      }
    })
    .otherwise(() => invalidDispatchRow(row))
}
