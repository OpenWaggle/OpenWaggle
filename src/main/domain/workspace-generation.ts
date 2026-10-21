import { matchBy } from '@diegogbrisa/ts-match'

/** A folder as seen by `lstat` (bigint), recorded so a later check can tell it is the same one. */
export interface WorkspaceDirectoryIdentity {
  /**
   * `st_dev`. macOS assigns it when it mounts a volume, and it changes across reboots (observed
   * 16777230 -> 16777233 -> 16777230), so a recorded value is only compared when birth time is
   * unknown. Otherwise it is kept for diagnosis.
   */
  readonly device: string
  readonly inode: string
  /** `birthtimeNs`. `0` when the filesystem does not record a birth time. */
  readonly birthtime: string
}

const UNKNOWN_BIRTHTIME = '0'

/**
 * Whether a live identity is the folder recorded in an earlier Host process or boot. The caller
 * fixes the path; inode plus nanosecond birth time tell a replacement at that path apart. Where
 * the filesystem records no birth time, the device number is the only extra signal, so it is
 * compared in that case alone.
 */
export function isSameDurableDirectoryIdentity(
  current: WorkspaceDirectoryIdentity | null | undefined,
  recorded: WorkspaceDirectoryIdentity,
) {
  if (!current) return false
  if (current.inode !== recorded.inode || current.birthtime !== recorded.birthtime) return false
  return recorded.birthtime !== UNKNOWN_BIRTHTIME || current.device === recorded.device
}

/** A string that changes exactly when `isSameDurableDirectoryIdentity` would report a change. */
export function durableDirectoryIdentityKey(identity: WorkspaceDirectoryIdentity) {
  return identity.birthtime === UNKNOWN_BIRTHTIME
    ? `${identity.device}:${identity.inode}:${UNKNOWN_BIRTHTIME}`
    : `${identity.inode}:${identity.birthtime}`
}

/** Why a worktree does or does not still match the folder its preparation was captured in. */
export type WorkspaceGenerationCheck =
  | { readonly status: 'current' }
  | { readonly status: 'unrecorded'; readonly workspacePath: string }
  | { readonly status: 'awaiting-birth'; readonly workspacePath: string }
  | {
      readonly status: 'unreadable'
      readonly workspacePath: string
      /** `missing`: nothing at the path. `not-a-folder`: a file, a symlink or a moved path. */
      readonly reason: 'missing' | 'not-a-folder'
      readonly recorded: WorkspaceDirectoryIdentity
    }
  | {
      readonly status: 'replaced'
      readonly workspacePath: string
      readonly recorded: WorkspaceDirectoryIdentity
      readonly observed: WorkspaceDirectoryIdentity
    }

export type WorkspaceGenerationMismatch = Exclude<
  WorkspaceGenerationCheck,
  { readonly status: 'current' }
>

const NANOSECONDS_PER_MILLISECOND = 1_000_000n

function describeBirthtime(birthtime: string) {
  if (birthtime === UNKNOWN_BIRTHTIME) return 'unknown creation time'
  // Stored as a string; a value that is not a nanosecond count is shown as it is.
  if (!/^\d+$/.test(birthtime)) return `birth time ${birthtime}`
  return `created ${new Date(Number(BigInt(birthtime) / NANOSECONDS_PER_MILLISECOND)).toISOString()}`
}

function describeIdentity(identity: WorkspaceDirectoryIdentity) {
  return `inode ${identity.inode}, ${describeBirthtime(identity.birthtime)}`
}

/**
 * Deleting, not moving, the folder: a moved copy of a git worktree still points at the git data
 * that Recreate worktree reuses. A missing worktree is what makes the Session offer recovery.
 */
const RECREATE = 'when you reopen this Session, choose Recreate worktree or Use current checkout'
const DELETE_AND_RECREATE = `commit or copy out any changes you want to keep, then delete that folder; ${RECREATE}`

/**
 * How a worktree fails its preparation check, in the words of the caller's sentence
 * ("This worktree <verdict> …: <problem>. <recovery>"). Callers with a different remedy, such
 * as worktree removal, leave out `recovery`. The raw identities, device included, go to the
 * Host log rather than the message.
 */
export function describeWorkspaceGenerationMismatch(check: WorkspaceGenerationMismatch): {
  readonly verdict: 'no longer matches' | 'cannot be checked against'
  readonly problem: string
  readonly recovery: string
} {
  return matchBy(check, 'status')
    .with('replaced', ({ workspacePath, recorded, observed }) => ({
      verdict: 'no longer matches' as const,
      problem: `${workspacePath} is a different folder from the one that was prepared (prepared: ${describeIdentity(recorded)}; found: ${describeIdentity(observed)})`,
      recovery: `If you moved or renamed the original folder, move it back. Otherwise ${DELETE_AND_RECREATE}.`,
    }))
    .with('unreadable', ({ workspacePath, reason }) =>
      reason === 'missing'
        ? {
            verdict: 'no longer matches' as const,
            problem: `${workspacePath} is missing`,
            recovery: `If you moved or renamed it, move it back. Otherwise, ${RECREATE}.`,
          }
        : {
            verdict: 'no longer matches' as const,
            problem: `${workspacePath} is not a plain folder`,
            recovery: `Remove what is at that path; ${RECREATE}.`,
          },
    )
    .with('awaiting-birth', ({ workspacePath }) => ({
      verdict: 'cannot be checked against' as const,
      problem: `the preparation was reset for a new worktree and has not recorded ${workspacePath} yet`,
      recovery: `To continue, ${DELETE_AND_RECREATE}.`,
    }))
    .with('unrecorded', ({ workspacePath }) => ({
      verdict: 'cannot be checked against' as const,
      problem: `the preparation has no record of the folder ${workspacePath}`,
      recovery: `To continue, ${DELETE_AND_RECREATE}.`,
    }))
    .exhaustive()
}
